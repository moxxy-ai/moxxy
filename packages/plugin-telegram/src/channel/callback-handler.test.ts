import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';
import { handleCallback, type CallbackState, type CallbackCallbacks } from './callback-handler.js';

/**
 * A46: the inline-keyboard callback path must enforce the SAME pairing gate
 * the text/voice handlers do — button clicks resolve permission prompts and
 * approvals, so an unpaired chat's clicks must be refused, not processed.
 */

const fakeCtx = (over: Partial<{ chatId: number | undefined; data: string }> = {}) => {
  const answers: Array<{ text?: string }> = [];
  const answerCallbackQuery = vi.fn(async (arg?: { text?: string }) => {
    answers.push(arg ?? {});
    return true;
  });
  const chat = over.chatId === undefined ? undefined : { id: over.chatId };
  return {
    ctx: {
      chat,
      callbackQuery: {
        data: over.data ?? 'perm:call-1:allow',
        message: chat ? { chat } : undefined,
      },
      answerCallbackQuery,
      editMessageReplyMarkup: vi.fn(async () => true),
    } as unknown as Context,
    answers,
    answerCallbackQuery,
  };
};

const makeState = (over: Partial<CallbackState> = {}): { state: CallbackState; resolvePending: ReturnType<typeof vi.fn> } => {
  const resolvePending = vi.fn(() => true);
  const state: CallbackState = {
    bot: null,
    session: null,
    chatId: null,
    permissionResolver: { resolvePending } as never,
    approvalResolver: { getPending: () => undefined, resolvePending: vi.fn() } as never,
    pairing: { isAuthorized: () => true },
    ...over,
  };
  return { state, resolvePending };
};

const cb: CallbackCallbacks = {
  setAwaitingApprovalText: () => undefined,
  setActiveModelOverride: () => undefined,
};

describe('handleCallback — pairing gate (A46)', () => {
  it('refuses a callback from an unpaired chat without touching any resolver', async () => {
    const { ctx, answers } = fakeCtx({ chatId: 666 });
    const { state, resolvePending } = makeState({ pairing: { isAuthorized: (id) => id !== 666 } });
    await handleCallback(ctx, state, cb);
    expect(resolvePending).not.toHaveBeenCalled();
    expect(answers.some((a) => /paired/i.test(a.text ?? ''))).toBe(true);
  });

  it('refuses a callback with no resolvable chat id (e.g. inline-message callbacks)', async () => {
    const { ctx } = fakeCtx({ chatId: undefined });
    const { state, resolvePending } = makeState({ pairing: { isAuthorized: () => true } });
    await handleCallback(ctx, state, cb);
    expect(resolvePending).not.toHaveBeenCalled();
  });

  it('processes a callback from the paired chat (perm: resolves the pending call)', async () => {
    const { ctx } = fakeCtx({ chatId: 42, data: 'perm:call-1:allow' });
    const { state, resolvePending } = makeState({ pairing: { isAuthorized: (id) => id === 42 } });
    await handleCallback(ctx, state, cb);
    expect(resolvePending).toHaveBeenCalledWith('call-1', { mode: 'allow' });
  });

  it('gates every dispatch prefix, not just perm:', async () => {
    for (const data of ['appr:a1:opt', 'model:openai::gpt-x', 'mode:goal']) {
      const { ctx, answerCallbackQuery } = fakeCtx({ chatId: 666, data });
      const getPending = vi.fn();
      const { state } = makeState({
        pairing: { isAuthorized: () => false },
        approvalResolver: { getPending, resolvePending: vi.fn() } as never,
      });
      await handleCallback(ctx, state, cb);
      // The only reply is the refusal — the handlers behind the prefixes
      // were never consulted.
      expect(getPending).not.toHaveBeenCalled();
      expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
    }
  });
});
