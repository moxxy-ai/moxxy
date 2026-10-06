import type { Context } from 'grammy';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { TelegramApprovalResolver } from '../approval.js';
import type { TelegramPermissionResolver } from '../permission.js';
import type { ChannelHandle } from '@moxxy/sdk';
import type { FramePump } from './frame-pump.js';
import { applySessionAction } from '@moxxy/channel-kit';
import { runSlash } from './slash-handler.js';
import type { TelegramModel } from './model.js';
import type { AwaitingApprovalText } from './callback-handler.js';
import type { PairingHandler } from './pairing-handler.js';

export interface TextHandlerState {
  readonly session: Session | null;
  readonly voiceReplies: boolean;
  readonly busy: boolean;
  readonly turnController: AbortController | null;
  readonly awaitingApprovalText: AwaitingApprovalText | null;
  readonly handle: ChannelHandle | null;
}

export interface TextHandlerDeps {
  readonly pairing: PairingHandler;
  readonly approvalResolver: TelegramApprovalResolver;
  readonly permissionResolver: TelegramPermissionResolver;
  readonly framePump: FramePump;
}

export interface TextHandlerCallbacks {
  readonly setAwaitingApprovalText: (state: AwaitingApprovalText | null) => void;
  /** `/auto-approve` — switch the conversation's shared auto-approve. */
  readonly toggleYolo: () => Promise<boolean>;
  /** Drop the bot-local auto-approve flag (a `/new` conversation starts with it off). */
  readonly setYolo: (value: boolean) => void;
  readonly setVoiceReplies: (on: boolean) => Promise<void>;
  /** This bot's own model (`/model`). */
  readonly model: Pick<TelegramModel, 'run' | 'choices'>;
  readonly runUserTurn: (ctx: Context, chatId: number, text: string) => Promise<void>;
  /** Host-issued pairing fallback: try to pair an unauthorized chat whose message
   *  is the 6-digit code. Returns true when handled (so we skip the generic
   *  "not paired" reply). See {@link TelegramChannel.tryHostPair}. */
  readonly tryHostPair: (chatId: number, text: string) => Promise<boolean>;
}

/**
 * Top-level dispatch for inbound text messages: authorization gate,
 * awaiting-approval-text capture, /cancel, slash routing, and finally
 * the user-turn path.
 */
export async function handleTextMessage(
  ctx: Context,
  state: TextHandlerState,
  deps: TextHandlerDeps,
  cb: TextHandlerCallbacks,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const text = ctx.message?.text;
  if (!chatId || !text) return;

  if (!deps.pairing.isAuthorized(chatId)) {
    // Host-issued pairing: a bare 6-digit message from an unpaired chat may be
    // the code presented back to us. If so, pair and stop here.
    if (await cb.tryHostPair(chatId, text)) return;
    await ctx.reply(
      'This bot is paired with a different chat (or not paired yet). Run `moxxy telegram pair` to (re-)pair.',
    );
    return;
  }

  // Capture awaiting-text BEFORE the busy guard so the user can answer
  // an approval text prompt even while the strategy is technically
  // still mid-turn (it's pending on us).
  if (state.awaitingApprovalText) {
    const { approvalId, optionId } = state.awaitingApprovalText;
    cb.setAwaitingApprovalText(null);
    const handled = deps.approvalResolver.resolvePendingWithText(approvalId, optionId, text);
    if (handled) {
      await ctx.reply(`✓ submitted (${optionId})`);
    } else {
      await ctx.reply('that approval is no longer pending');
    }
    return;
  }

  // /cancel works even while busy; everything else routes through
  // runSlash or the user-turn path.
  if (text === '/cancel') {
    if (state.turnController && !state.turnController.signal.aborted) {
      state.turnController.abort('user cancel');
      await ctx.reply('cancelling current turn…');
    } else {
      await ctx.reply('nothing to cancel.');
    }
    return;
  }

  if (text.startsWith('/')) {
    await runSlash(
      ctx,
      text,
      { session: state.session, voiceReplies: state.voiceReplies },
      {
        toggleYolo: cb.toggleYolo,
        setVoiceReplies: cb.setVoiceReplies,
        model: cb.model,
        performSessionAction: (c, action, notice) =>
          performSessionAction(c, action, notice, state, deps, cb),
      },
    );
    return;
  }

  if (state.busy) {
    await ctx.reply('I am still working on the previous prompt. Send /cancel to abort it.');
    return;
  }

  await cb.runUserTurn(ctx, chatId, text);
}

/**
 * Channel-side handler for `session-action` outputs from registered commands
 * (`applySessionAction` in @moxxy/channel-kit, shared with the other bots).
 */
async function performSessionAction(
  ctx: Context,
  action: 'new' | 'clear' | 'exit',
  notice: string | undefined,
  state: TextHandlerState,
  deps: TextHandlerDeps,
  cb: TextHandlerCallbacks,
): Promise<void> {
  const reply = await applySessionAction(action, notice, {
    session: state.session,
    turnController: state.turnController,
    handle: state.handle,
    channelName: 'Telegram',
    abortPending: (reason) => {
      deps.approvalResolver.abortAll(reason);
      deps.permissionResolver.abortAll(reason);
    },
    onReset: (kind) => {
      deps.framePump.resetRenderer();
      if (kind !== 'new') return;
      cb.setYolo(false);
      cb.setAwaitingApprovalText(null);
    },
  });
  await ctx.reply(reply);
}
