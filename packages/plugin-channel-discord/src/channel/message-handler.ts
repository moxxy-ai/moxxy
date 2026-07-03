import type { ChannelHandle, ClientSession as Session } from '@moxxy/sdk';
import { gateInbound } from '../allow-list.js';
import type { InboundMessage } from '../schema.js';
import type { DiscordApprovalResolver } from '../approval.js';
import type { DiscordPermissionResolver } from '../permission.js';
import type { AllowListStore } from './allow-list-store.js';
import type { ChannelLogger, SendableChannelLike } from './discord-like.js';
import type { PairingHandler } from './pairing-handler.js';
import { runSlash } from './slash-handler.js';

export interface AwaitingApprovalText {
  approvalId: string;
  optionId: string;
}

/** A validated inbound message plus the transport bits needed to answer it. */
export interface InboundContext {
  readonly msg: InboundMessage;
  readonly channel: SendableChannelLike;
  reply(text: string): Promise<unknown>;
}

export interface MessageHandlerState {
  readonly session: Session | null;
  readonly busy: boolean;
  readonly turnController: AbortController | null;
  readonly awaitingApprovalText: AwaitingApprovalText | null;
  readonly handle: ChannelHandle | null;
  /** The bot's own user id (ignore self-authored messages defensively). */
  readonly botUserId: string | null;
}

export interface MessageHandlerDeps {
  readonly pairing: PairingHandler;
  readonly allowList: AllowListStore;
  readonly approvalResolver: DiscordApprovalResolver;
  readonly permissionResolver: DiscordPermissionResolver;
  readonly logger?: ChannelLogger;
}

export interface MessageHandlerCallbacks {
  readonly setAwaitingApprovalText: (state: AwaitingApprovalText | null) => void;
  readonly toggleYolo: () => boolean;
  readonly setYolo: (value: boolean) => void;
  /** Handle `/voice [on|off|status]` — persist + apply, return the reply text. */
  readonly voice: (arg: string) => Promise<string>;
  readonly runUserTurn: (ctx: InboundContext, text: string) => Promise<void>;
  /** Handle audio attachments (voice messages). Returns true when it consumed
   *  the message (so the text path is skipped). */
  readonly runVoiceMessage: (ctx: InboundContext) => Promise<boolean>;
}

/**
 * Top-level dispatch for inbound Discord messages. Every session-reaching path
 * is behind the pairing + allow-list gate (AGENTS.md A46: gate EVERY path):
 * validation happened upstream (the caller only builds an {@link
 * InboundContext} from a zod-validated extraction), authorization happens
 * here, and only then do approval-capture / cancel / slash / turn paths run.
 */
export async function handleInboundMessage(
  ctx: InboundContext,
  state: MessageHandlerState,
  deps: MessageHandlerDeps,
  cb: MessageHandlerCallbacks,
): Promise<void> {
  const { msg } = ctx;
  // Never react to bots (including ourselves) — bot-to-bot loops.
  if (msg.authorIsBot || (state.botUserId != null && msg.authorId === state.botUserId)) return;

  const text = msg.content.trim();
  const verdict = gateInbound(msg, deps.pairing.authorizedUserId(), deps.allowList.snapshot());

  if (!verdict.ok) {
    if (verdict.reason === 'not-paired' || verdict.reason === 'foreign-user') {
      // DMs get pairing guidance (a fresh code when a window is armed, a
      // rejection for a foreign account); guild messages are dropped silently
      // so an unpaired bot can't be made to spam a server.
      if (msg.guildId == null) {
        const reply = deps.pairing.handleUnpairedDm(msg.authorId);
        if (reply) await ctx.reply(reply);
      }
      return;
    }
    // Paired user in a guild channel that isn't allow-listed: /allow opts the
    // channel in (this is the ONE command that must work pre-allow-list —
    // it's how the list gets populated); anything else gets a hint.
    if (text === '/allow') {
      await deps.allowList.add(msg.channelId);
      await ctx.reply('✓ this channel can now drive moxxy. Use /deny here to revoke.');
      return;
    }
    await ctx.reply('This channel is not allow-listed. Send /allow here to enable it.');
    return;
  }

  if (!text && msg.attachments.length === 0) return;

  // Capture awaiting-text BEFORE the busy guard so the user can answer an
  // approval text prompt even while the strategy is technically mid-turn
  // (it's pending on us).
  if (state.awaitingApprovalText && text) {
    const { approvalId, optionId } = state.awaitingApprovalText;
    cb.setAwaitingApprovalText(null);
    const handled = deps.approvalResolver.resolvePendingWithText(approvalId, optionId, text);
    await ctx.reply(handled ? `✓ submitted (${optionId})` : 'that approval is no longer pending');
    return;
  }

  // /cancel works even while busy; everything else routes below.
  if (text === '/cancel') {
    if (state.turnController && !state.turnController.signal.aborted) {
      state.turnController.abort('user cancel');
      await ctx.reply('cancelling current turn…');
    } else {
      await ctx.reply('nothing to cancel.');
    }
    return;
  }

  if (text === '/deny' && msg.guildId != null) {
    const removed = await deps.allowList.remove(msg.channelId);
    await ctx.reply(removed ? '✓ channel removed from the allow-list.' : 'this channel was not allow-listed.');
    return;
  }
  if (text === '/allow' && msg.guildId != null) {
    await ctx.reply('this channel is already allow-listed.');
    return;
  }

  if (text.startsWith('/')) {
    if (!state.session) return;
    const [head, ...rest] = text.split(/\s+/);
    const reply = await runSlash(head!.slice(1), rest.join(' '), state.session, {
      toggleYolo: cb.toggleYolo,
      voice: cb.voice,
      performSessionAction: (action, notice) =>
        performSessionAction(action, notice, state, deps, cb),
    });
    if (reply) await ctx.reply(reply.length > 1_900 ? reply.slice(0, 1_899) + '…' : reply);
    return;
  }

  // Voice messages / audio uploads take the transcribe-then-turn path.
  if (await cb.runVoiceMessage(ctx)) return;
  if (!text) return;

  if (state.busy) {
    await ctx.reply('I am still working on the previous prompt. Send /cancel to abort it.');
    return;
  }

  await cb.runUserTurn(ctx, text);
}

/**
 * Channel-side handler for `session-action` outputs from registered commands.
 * Mirrors the Telegram channel's semantics; returns the reply text. Shared by
 * the plain-text slash path (above) and the interaction (slash-command) path
 * in the channel.
 */
export async function performSessionAction(
  action: 'new' | 'clear' | 'exit',
  notice: string | undefined,
  state: Pick<MessageHandlerState, 'session' | 'turnController' | 'handle'>,
  deps: Pick<MessageHandlerDeps, 'approvalResolver' | 'permissionResolver'>,
  cb: Pick<MessageHandlerCallbacks, 'setAwaitingApprovalText' | 'setYolo'>,
): Promise<string> {
  if (!state.session) return 'session is not ready yet.';
  if (action === 'exit') {
    // Fire the stop AFTER we return so the reply can still be delivered.
    setTimeout(() => void state.handle?.stop('user /exit'), 250);
    return notice ?? 'closing Discord channel';
  }
  if (action === 'clear') {
    return `✓ ${notice ?? 'cleared'}`;
  }
  // action === 'new'
  if (state.turnController && !state.turnController.signal.aborted) {
    state.turnController.abort('user reset');
  }
  cb.setYolo(false);
  cb.setAwaitingApprovalText(null);
  deps.approvalResolver.abortAll('session reset');
  deps.permissionResolver.abortAll('session reset');
  // Wipe the history at its source (RemoteSession.reset() asks the runner; a
  // mirror-only log.clear() would desync) and only claim success when the
  // reset actually happened (AGENTS.md A10).
  try {
    if (typeof state.session.reset === 'function') await state.session.reset();
    else state.session.log.clear();
  } catch (err) {
    return `⚠ /new failed: ${err instanceof Error ? err.message : String(err)} — history NOT cleared`;
  }
  return `✓ ${notice ?? 'new session — conversation history cleared'}`;
}
