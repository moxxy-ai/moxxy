import type { Bot, Context } from 'grammy';
import { savePreferences } from '@moxxy/core';
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
  setActiveModelOverride(modelId: string): void;
}

/** Inline-keyboard callback router. Dispatches by prefix:
 *  - `perm:`   → permission resolver
 *  - `appr:`   → approval resolver
 *  - `model:`  → provider+model switch (with credential resolve)
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
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
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
    await handleModel(ctx, data, state.session, cb);
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

async function handleModel(
  ctx: Context,
  data: string,
  session: Session | null,
  cb: CallbackCallbacks,
): Promise<void> {
  // Format: model:<providerName>::<modelId>
  const payload = data.slice(6);
  const [providerId, modelId] = payload.split('::');
  if (!providerId || !modelId || !session) {
    await ctx.answerCallbackQuery({ text: 'invalid model selection' });
    return;
  }
  // Intercept switches to unconfigured providers — otherwise OAuth-
  // backed providers (openai-codex) would surface a credential
  // error on the next turn. Match the TUI's wording so the user
  // sees the same setup command in both channels.
  const ready = session.readyProviders ?? new Set<string>();
  if (!ready.has(providerId)) {
    const cmd =
      providerId === 'openai-codex'
        ? 'moxxy login openai-codex'
        : `moxxy init   # (will prompt for ${providerId.toUpperCase()}_API_KEY)`;
    await ctx.answerCallbackQuery({ text: `${providerId} not connected` });
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(
          `${providerId} isn't connected.\n\nRun \`${cmd}\` then restart moxxy.`,
          { parse_mode: 'Markdown' },
        );
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    if (session.providers.getActiveName() !== providerId) {
      // Resolve credentials and drop the cached instance, same as
      // the TUI. Without this the new provider gets createClient({})
      // and openai-codex throws "no OAuth credentials" on next turn.
      const resolver = session.credentialResolver;
      const cfg = resolver ? await resolver(providerId) : {};
      const def = session.providers.list().find((p) => p.name === providerId);
      if (def) session.providers.replace(def);
      session.providers.setActive(providerId, cfg);
    }
    cb.setActiveModelOverride(modelId);
    // Persist for next CLI run — same preferences file the TUI writes. Await it
    // so a write failure (disk/permission/lock) is caught below and reported,
    // instead of telling the user "✓ switched" while the preference silently
    // never landed (and leaking an unhandled rejection).
    await savePreferences({ providerName: providerId, model: modelId });
    await ctx.answerCallbackQuery({ text: `→ ${providerId}:${modelId}` });
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(`✓ switched to ${providerId}:${modelId}`);
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
  try {
    session.modes.setActive(modeName);
    // Await so a persistence failure is caught below (and reported) rather than
    // claiming success while the preference silently never landed.
    await savePreferences({ mode: modeName });
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
