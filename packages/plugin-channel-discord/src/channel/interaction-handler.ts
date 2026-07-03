import type { ClientSession as Session } from '@moxxy/sdk';
import type { PermissionDecision } from '@moxxy/sdk';
import type { DiscordApprovalResolver } from '../approval.js';
import type { DiscordPermissionResolver } from '../permission.js';
import type { AllowListStore } from './allow-list-store.js';
import type { ChannelLogger } from './discord-like.js';
import type { AwaitingApprovalText } from './message-handler.js';
import type { PairingHandler } from './pairing-handler.js';
import { runSlash } from './slash-handler.js';

/**
 * Structural slice of a discord.js Interaction the handler needs — buttons
 * (permission / approval prompts) and chat-input (slash) commands. Kept
 * structural so tests drive it with plain objects.
 */
export interface InteractionLike {
  isButton(): boolean;
  isChatInputCommand(): boolean;
  /** Button custom id (`perm:<callId>:<choice>` / `appr:<id>:<optionId>`). */
  readonly customId?: string;
  /** Slash-command name. */
  readonly commandName?: string;
  readonly user: { readonly id: string };
  readonly channelId?: string | null;
  readonly guildId?: string | null;
  reply(payload: { content: string; ephemeral?: boolean }): Promise<unknown>;
  /** Buttons only: edit the prompt message (used to clear the button row).
   *  NB: this ACKS the interaction — any later message must use followUp. */
  update?(payload: { components: ReadonlyArray<unknown> }): Promise<unknown>;
  /** Post-ack follow-up message (valid only after update/reply succeeded). */
  followUp?(payload: { content: string; ephemeral?: boolean }): Promise<unknown>;
}

export interface InteractionState {
  readonly session: Session | null;
  readonly turnController: AbortController | null;
}

export interface InteractionDeps {
  readonly pairing: PairingHandler;
  readonly allowList: AllowListStore;
  readonly permissionResolver: DiscordPermissionResolver;
  readonly approvalResolver: DiscordApprovalResolver;
  readonly logger?: ChannelLogger;
}

export interface InteractionCallbacks {
  readonly setAwaitingApprovalText: (state: AwaitingApprovalText | null) => void;
  readonly toggleYolo: () => boolean;
  /** Handle `/voice [on|off|status]` — persist + apply, return the reply text. */
  readonly voice: (arg: string) => Promise<string>;
  readonly performSessionAction: (
    action: 'new' | 'clear' | 'exit',
    notice: string | undefined,
  ) => Promise<string>;
}

/**
 * Interaction router (button clicks + slash commands). The authorization gate
 * runs FIRST and for EVERY path (AGENTS.md A46 — Telegram's callback handlers
 * once skipped it): button clicks resolve permission prompts and approvals,
 * slash commands reach the session, and a prompt message can be seen (and its
 * buttons clicked) by any member of a guild channel — so an unpaired user's
 * interactions must be refused exactly like their messages.
 */
export async function handleInteraction(
  interaction: InteractionLike,
  state: InteractionState,
  deps: InteractionDeps,
  cb: InteractionCallbacks,
): Promise<void> {
  if (!interaction.isButton() && !interaction.isChatInputCommand()) return;

  if (!deps.pairing.isAuthorized(interaction.user.id)) {
    await safeReply(interaction, 'This bot is paired with a different Discord account.', deps.logger);
    return;
  }

  if (interaction.isButton()) {
    await handleButton(interaction, deps, cb);
    return;
  }
  await handleSlashCommand(interaction, state, deps, cb);
}

async function handleButton(
  interaction: InteractionLike,
  deps: InteractionDeps,
  cb: InteractionCallbacks,
): Promise<void> {
  const data = interaction.customId ?? '';
  if (data.startsWith('perm:')) {
    const parts = data.split(':');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return;
    const handled = deps.permissionResolver.resolvePending(parts[1], mapChoice(parts[2]));
    const acked = await clearButtons(interaction, deps.logger);
    if (!handled) await respond(interaction, 'no pending permission', acked, deps.logger);
    // A click must always be acked or Discord shows "interaction failed".
    else if (!acked) await respond(interaction, `→ ${parts[2]}`, acked, deps.logger);
    return;
  }
  if (data.startsWith('appr:')) {
    const idx = data.indexOf(':', 5);
    if (idx < 0) return;
    const approvalId = data.slice(5, idx);
    const optionId = data.slice(idx + 1);
    const pending = deps.approvalResolver.getPending(approvalId);
    if (!pending) {
      await safeReply(interaction, 'no pending approval', deps.logger);
      return;
    }
    const option = pending.request.options.find((o) => o.id === optionId);
    if (!option) {
      await safeReply(interaction, 'unknown option', deps.logger);
      return;
    }
    const acked = await clearButtons(interaction, deps.logger);
    if (option.requestsText) {
      // Don't resolve yet — capture the user's next message as the follow-up
      // text. Mirrors the TUI dialog's text-entry sub-mode.
      cb.setAwaitingApprovalText({ approvalId, optionId });
      const prompt =
        option.textPrompt ??
        `Send your message — the next text you type becomes the ${optionId} input.`;
      await respond(interaction, `✏️ ${prompt}`, acked, deps.logger);
      return;
    }
    deps.approvalResolver.resolvePending(approvalId, optionId);
    await respond(interaction, `→ ${option.label}`, acked, deps.logger);
  }
}

async function handleSlashCommand(
  interaction: InteractionLike,
  state: InteractionState,
  deps: InteractionDeps,
  cb: InteractionCallbacks,
): Promise<void> {
  const name = interaction.commandName ?? '';
  const channelId = interaction.channelId ?? null;
  const inGuild = interaction.guildId != null;

  // Allow-list management works from the guild channel itself; /allow is the
  // one command that must work BEFORE the channel is allow-listed.
  if (name === 'allow' && inGuild && channelId) {
    await deps.allowList.add(channelId);
    await safeReply(interaction, '✓ this channel can now drive moxxy. Use /deny here to revoke.', deps.logger);
    return;
  }
  if (name === 'deny' && inGuild && channelId) {
    const removed = await deps.allowList.remove(channelId);
    await safeReply(
      interaction,
      removed ? '✓ channel removed from the allow-list.' : 'this channel was not allow-listed.',
      deps.logger,
    );
    return;
  }

  // Everything else obeys the same channel gate as plain messages: a guild
  // channel must be allow-listed (DMs with the paired user always pass).
  if (inGuild && channelId && !deps.allowList.has(channelId)) {
    await safeReply(interaction, 'This channel is not allow-listed. Send /allow here to enable it.', deps.logger);
    return;
  }

  if (name === 'cancel') {
    if (state.turnController && !state.turnController.signal.aborted) {
      state.turnController.abort('user cancel');
      await safeReply(interaction, 'cancelling current turn…', deps.logger);
    } else {
      await safeReply(interaction, 'nothing to cancel.', deps.logger);
    }
    return;
  }

  if (!state.session) {
    await safeReply(interaction, 'Session is not ready yet.', deps.logger);
    return;
  }
  const reply = await runSlash(name, '', state.session, {
    toggleYolo: cb.toggleYolo,
    voice: cb.voice,
    performSessionAction: cb.performSessionAction,
  });
  await safeReply(interaction, reply.length > 1_900 ? reply.slice(0, 1_899) + '…' : reply, deps.logger);
}

function mapChoice(choice: string): PermissionDecision {
  if (choice === 'allow') return { mode: 'allow' };
  if (choice === 'allow_session') return { mode: 'allow_session' };
  return { mode: 'deny', reason: 'denied by user' };
}

/** Clear the prompt's button row. Returns true when the update ACKED the
 *  interaction (later messages must then use followUp, not reply). */
async function clearButtons(interaction: InteractionLike, logger?: ChannelLogger): Promise<boolean> {
  if (!interaction.update) return false;
  try {
    await interaction.update({ components: [] });
    return true;
  } catch (err) {
    logger?.warn('discord clear-buttons failed', { err: String(err) });
    return false;
  }
}

/** Send a user-visible ack: followUp when the interaction was already acked
 *  (a successful `update`), plain ephemeral reply otherwise. */
async function respond(
  interaction: InteractionLike,
  content: string,
  acked: boolean,
  logger?: ChannelLogger,
): Promise<void> {
  try {
    if (acked && interaction.followUp) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (err) {
    logger?.warn('discord interaction respond failed', { err: String(err) });
  }
}

async function safeReply(
  interaction: InteractionLike,
  content: string,
  logger?: ChannelLogger,
): Promise<void> {
  try {
    await interaction.reply({ content, ephemeral: true });
  } catch (err) {
    logger?.warn('discord interaction reply failed', { err: String(err) });
  }
}
