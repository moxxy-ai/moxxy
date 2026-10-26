import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';

// The manifest writer (setCategoryDefault) can reject on disk/permission/lock.
// Mock it so we can drive the failure path.
const setCategoryDefault = vi.fn(async () => {});
vi.mock('@moxxy/config', () => ({
  setCategoryDefault: (...a: unknown[]) => setCategoryDefault(...a),
}));

import { Session } from '@moxxy/core';
import { ChatQuestions, type QuestionUpdate } from '@moxxy/channel-kit';
import { defineTool, z, type QuestionOutcome } from '@moxxy/sdk';
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
    questions: new ChatQuestions(() => null),
    ...over,
  };
  return { state, resolvePending };
};

const cb: CallbackCallbacks = {
  setAwaitingApprovalText: () => undefined,
  model: { run: async () => '', choices: async () => ({ current: null, options: [] }) },
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

describe('handleCallback — a Question button', () => {
  it('answers the Question with the clicked answer and stops the button spinner', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    session.tools.register(
      defineTool({
        name: 'asks',
        description: 'Asks the person.',
        inputSchema: z.object({}),
        handler: async (_input, ctx) =>
          ctx.ask
            ? ctx.ask([{ id: 'q1', question: 'Which colour?', options: [{ id: 'red', label: 'Red' }], multiSelect: false, allowOther: false }])
            : 'no ask',
      }),
    );
    const questions = new ChatQuestions(() => session);
    const updates: QuestionUpdate[] = [];
    questions.attach((update) => updates.push(update));
    const asked = session.tools.execute('asks', {}, new AbortController().signal, { turnId: 't1' }) as Promise<QuestionOutcome>;
    await new Promise((resolve) => setImmediate(resolve));
    const shown = updates[0];
    if (!shown || shown.kind !== 'show') throw new Error('expected the card');
    const red = shown.card.rows.flat()[0];
    if (!red) throw new Error('expected the Red button');
    const { ctx, answerCallbackQuery } = fakeCtx({ chatId: 42, data: red.data });
    const { state } = makeState({ questions });

    await handleCallback(ctx, state, cb);

    await expect(asked).resolves.toEqual({ kind: 'answered', answers: { q1: { selected: ['red'] } } });
    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
  });
});

describe('handleCallback — mode persistence failure (u110-5)', () => {
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

});
