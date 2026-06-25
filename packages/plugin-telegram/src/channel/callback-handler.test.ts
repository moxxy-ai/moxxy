import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';

// The manifest writers (setCategoryDefault/setProviderModel) can reject on
// disk/permission/lock. Mock them so we can drive the failure path.
const setCategoryDefault = vi.fn(async () => {});
const setProviderModel = vi.fn(async () => {});
vi.mock('@moxxy/config', () => ({
  setCategoryDefault: (...a: unknown[]) => setCategoryDefault(...a),
  setProviderModel: (...a: unknown[]) => setProviderModel(...a),
}));

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

describe('handleCallback — model/mode persistence failure (u110-5)', () => {
  const fakeSession = () =>
    ({
      readyProviders: new Set(['openai']),
      providers: {
        getActiveName: () => 'openai',
        list: () => [{ name: 'openai' }],
        replace: vi.fn(),
        setActive: vi.fn(),
      },
      modes: {
        setActive: vi.fn(),
        list: () => [{ name: 'default' }, { name: 'goal' }],
      },
      credentialResolver: undefined,
    }) as unknown as CallbackState['session'];

  const ctxWithEdit = (data: string) => {
    const editMessageText = vi.fn(async () => true);
    const answerCallbackQuery = vi.fn(async () => true);
    const chat = { id: 42 };
    return {
      ctx: {
        chat,
        callbackQuery: { data, message: { chat } },
        answerCallbackQuery,
        editMessageText,
        editMessageReplyMarkup: vi.fn(async () => true),
      } as unknown as Context,
      editMessageText,
      answerCallbackQuery,
    };
  };

  const stateFor = (session: CallbackState['session']): CallbackState => ({
    bot: null,
    session,
    chatId: null,
    permissionResolver: { resolvePending: vi.fn() } as never,
    approvalResolver: { getPending: () => undefined, resolvePending: vi.fn() } as never,
    pairing: { isAuthorized: () => true },
  });

  it('does NOT claim "✓ switched" when the manifest write rejects (model)', async () => {
    setCategoryDefault.mockReset();
    setProviderModel.mockReset();
    setCategoryDefault.mockRejectedValueOnce(new Error('EROFS'));
    const { ctx, editMessageText, answerCallbackQuery } = ctxWithEdit('model:openai::gpt-x');
    await handleCallback(ctx, stateFor(fakeSession()), cb);

    expect(setCategoryDefault).toHaveBeenCalledWith('provider', 'openai');
    // The success edit must NOT have fired; the failure surfaces via the toast.
    const successEdits = editMessageText.mock.calls.filter((c) =>
      String(c[0]).includes('✓ switched'),
    );
    expect(successEdits).toHaveLength(0);
    expect(
      answerCallbackQuery.mock.calls.some((c) => /failed/i.test(String((c[0] as { text?: string } | undefined)?.text))),
    ).toBe(true);
  });

  it('does NOT claim "✓ mode →" when the manifest write rejects (mode)', async () => {
    setCategoryDefault.mockReset();
    setCategoryDefault.mockRejectedValueOnce(new Error('EROFS'));
    const { ctx, editMessageText, answerCallbackQuery } = ctxWithEdit('mode:goal');
    await handleCallback(ctx, stateFor(fakeSession()), cb);

    expect(setCategoryDefault).toHaveBeenCalledWith('mode', 'goal');
    const successEdits = editMessageText.mock.calls.filter((c) =>
      String(c[0]).includes('✓ mode'),
    );
    expect(successEdits).toHaveLength(0);
    expect(
      answerCallbackQuery.mock.calls.some((c) => /failed/i.test(String((c[0] as { text?: string } | undefined)?.text))),
    ).toBe(true);
  });

  it('persists and confirms success when the manifest writes resolve (model)', async () => {
    setCategoryDefault.mockReset();
    setProviderModel.mockReset();
    const { ctx, editMessageText } = ctxWithEdit('model:openai::gpt-x');
    await handleCallback(ctx, stateFor(fakeSession()), cb);
    expect(
      editMessageText.mock.calls.some((c) => String(c[0]).includes('✓ switched')),
    ).toBe(true);
  });
});
