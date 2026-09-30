import type { Bot, Context } from 'grammy';
import { setCategoryDefault } from '@moxxy/config';
import { isSelectableMode } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { PermissionDecision } from '@moxxy/sdk';
import type { TelegramPermissionResolver } from '../permission.js';
import type { TelegramApprovalResolver } from '../approval.js';

export interface AwaitingApprovalText {
  approvalId: string;
  optionId: string;
}

export interface CallbackState {
  readonly bot: Bot | null;
  readonly session: Session | null;
  readonly chatId: number | null;
  readonly permissionResolver: TelegramPermissionResolver;
  readonly approvalResolver: TelegramApprovalResolver;
  /** Pairing gate — the same authorization check the text/voice handlers enforce. */
  readonly pairing: { isAuthorized(chatId: number): boolean };
}

export interface CallbackCallbacks {
  /** Latch an in-flight approval awaiting a text follow-up. */
  setAwaitingApprovalText(state: AwaitingApprovalText | null): void;
  /** Switch this bot's model (`/model <value>`); returns the reply. */
  model(arg: string): Promise<string>;
}

/** Inline-keyboard callback router. Dispatches by prefix:
 *  - `perm:`   → permission resolver
 *  - `appr:`   → approval resolver
 *  - `model:`  → this bot's model (`provider::model` or `default`)
 *  - `mode:`   → mode switch
 */
export async function handleCallback(
  ctx: Context,
  state: CallbackState,
  cb: CallbackCallbacks,
): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  // Authorization gate — mirror the text/voice handlers. Button clicks can
  // resolve permission prompts, approve plans, and switch provider/model/mode,
  // so an unpaired chat's callbacks must be refused just like its messages
  // (inline-keyboard messages can be forwarded to arbitrary chats).
  const callbackMessage = ctx.callbackQuery?.message;
  const callbackChat = callbackMessage?.chat;
  const chatId = ctx.chat?.id ?? callbackChat?.id;
  if (chatId === undefined || !state.pairing.isAuthorized(chatId)) {
    try {
      await ctx.answerCallbackQuery({ text: 'This bot is paired with a different chat.' });
    } catch {
      /* ignore */
    }
    return;
  }

  if (data.startsWith('perm:')) {
    await handlePerm(ctx, data, state.permissionResolver);
    return;
  }
  if (data.startsWith('appr:')) {
    await handleAppr(ctx, data, state, cb);
    return;
  }
  if (data.startsWith('model:')) {
    await handleModel(ctx, data.slice('model:'.length), cb);
    return;
  }
  if (data.startsWith('mode:')) {
    await handleMode(ctx, data, state.session);
    return;
  }
}

async function handlePerm(
  ctx: Context,
  data: string,
  resolver: TelegramPermissionResolver,
): Promise<void> {
  const parts = data.split(':');
  if (parts.length !== 3) return;
  const [, callId, choice] = parts;
  if (!callId || !choice) return;
  const decision = mapChoice(choice);
  const handled = resolver.resolvePending(callId, decision);
  await ctx.answerCallbackQuery({ text: handled ? choice : 'no pending permission' });
  if (handled && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageReplyMarkup({});
    } catch {
      /* ignore */
    }
  }
}

async function handleAppr(
  ctx: Context,
  data: string,
  state: CallbackState,
  cb: CallbackCallbacks,
): Promise<void> {
  // Format: appr:<approvalId>:<optionId>
  const idx = data.indexOf(':', 5);
  if (idx < 0) return;
  const approvalId = data.slice(5, idx);
  const optionId = data.slice(idx + 1);
  const pending = state.approvalResolver.getPending(approvalId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: 'no pending approval' });
    return;
  }
  const option = pending.request.options.find((o) => o.id === optionId);
  if (!option) {
    await ctx.answerCallbackQuery({ text: 'unknown option' });
    return;
  }
  // Clear the inline keyboard so the user can't double-click.
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageReplyMarkup({});
    } catch {
      /* ignore */
    }
  }
  if (option.requestsText) {
    // Don't resolve yet — capture the user's next message as the
    // follow-up text. Mirrors the TUI dialog's text-entry sub-mode.
    cb.setAwaitingApprovalText({ approvalId, optionId });
    await ctx.answerCallbackQuery({ text: option.label });
    const prompt =
      option.textPrompt ??
      `Send your message — the next text you type becomes the ${optionId} input.`;
    if (state.chatId && state.bot) {
      try {
        await state.bot.api.sendMessage(state.chatId, `✏️ ${prompt}`);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  state.approvalResolver.resolvePending(approvalId, optionId);
  await ctx.answerCallbackQuery({ text: option.label });
}

/** A tapped `/model` button: the same switch as `/model <value>`, answered in place. */
async function handleModel(ctx: Context, value: string, cb: CallbackCallbacks): Promise<void> {
  if (!value) {
    await ctx.answerCallbackQuery({ text: 'invalid model selection' });
    return;
  }
  const reply = await cb.model(value);
  await ctx.answerCallbackQuery({ text: reply.slice(0, 190) });
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(reply);
    } catch {
      /* ignore */
    }
  }
}

async function handleMode(
  ctx: Context,
  data: string,
  session: Session | null,
): Promise<void> {
  const modeName = data.slice(5);
  if (!modeName || !session) {
    await ctx.answerCallbackQuery({ text: 'invalid mode' });
    return;
  }
  // Refuse a special mode reached by name (e.g. a stale callback) — special
  // modes are entered only via their own command. Mirrors the TUI guard.
  const target = session.modes.list().find((m) => m.name === modeName);
  if (target && !isSelectableMode(target)) {
    await ctx.answerCallbackQuery({ text: `"${modeName}" is a special mode` });
    return;
  }
  try {
    session.modes.setActive(modeName);
    // Await so a persistence failure is caught below (and reported) rather than
    // claiming success while it silently never landed.
    await setCategoryDefault('mode', modeName);
    await ctx.answerCallbackQuery({ text: `mode → ${modeName}` });
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(`✓ mode → ${modeName}`);
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    await ctx.answerCallbackQuery({
      text: `failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function mapChoice(choice: string): PermissionDecision {
  if (choice === 'allow') return { mode: 'allow' };
  if (choice === 'allow_session') return { mode: 'allow_session' };
  return { mode: 'deny', reason: 'denied by user' };
}
