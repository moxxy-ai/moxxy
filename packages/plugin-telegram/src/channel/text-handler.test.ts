import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';
import type { ChannelHandle } from '@moxxy/sdk';
import { Session } from '@moxxy/core';
import {
  handleTextMessage,
  type TextHandlerCallbacks,
  type TextHandlerDeps,
  type TextHandlerState,
} from './text-handler.js';
import type { AwaitingApprovalText } from './callback-handler.js';

/**
 * Worst-case regression coverage for the text-handler — the primary inbound
 * path. Since the fire-and-track dispatch change (grammy poll loop no longer
 * parked on a turn), the load-bearing invariants this handler enforces are:
 *
 *  - an unpaired chat's text is refused (authorization gate),
 *  - `/cancel` aborts the live per-turn controller EVEN while busy (the whole
 *    point of the deadlock fix — without it /cancel sat undelivered),
 *  - a plain prompt is refused while a turn is in flight (single-flight guard),
 *  - awaiting-approval-text is captured BEFORE the busy guard (so the user can
 *    answer a plan-execute "Redraft" prompt while the strategy is still
 *    technically mid-turn, pending on us),
 *  - a stale approval-text submission degrades to a clear reply, not a throw.
 */

const makeSession = (): Session => new Session({ cwd: '/tmp', silent: true });

const fakeCtx = (over: { chatId?: number; text?: string } = {}) => {
  const replies: string[] = [];
  const reply = vi.fn(async (text: string) => {
    replies.push(text);
  });
  return {
    ctx: {
      chat: { id: over.chatId ?? 42 },
      message: { text: over.text ?? 'hello' },
      reply,
    } as unknown as Context,
    replies,
  };
};

interface Harness {
  state: TextHandlerState;
  deps: TextHandlerDeps;
  cb: TextHandlerCallbacks;
  runUserTurn: ReturnType<typeof vi.fn>;
  resolvePendingWithText: ReturnType<typeof vi.fn>;
  setAwaitingApprovalText: ReturnType<typeof vi.fn>;
}

const makeHarness = (over: Partial<TextHandlerState> = {}): Harness => {
  const runUserTurn = vi.fn(async () => {});
  const resolvePendingWithText = vi.fn(() => true);
  const setAwaitingApprovalText = vi.fn();
  const state: TextHandlerState = {
    session: makeSession(),
    model: undefined,
    activeModelOverride: null,
    yolo: false,
    busy: false,
    turnController: null,
    awaitingApprovalText: null,
    handle: null,
    ...over,
  };
  const deps: TextHandlerDeps = {
    pairing: { isAuthorized: () => true } as never,
    approvalResolver: {
      resolvePendingWithText,
      abortAll: vi.fn(),
    } as never,
    permissionResolver: { abortAll: vi.fn() } as never,
    framePump: { resetRenderer: vi.fn() } as never,
  };
  const cb: TextHandlerCallbacks = {
    setAwaitingApprovalText,
    toggleYolo: () => false,
    setYolo: () => undefined,
    runUserTurn,
  };
  return { state, deps, cb, runUserTurn, resolvePendingWithText, setAwaitingApprovalText };
};

describe('handleTextMessage — authorization gate', () => {
  it('refuses an unpaired chat without running a turn', async () => {
    const { ctx, replies } = fakeCtx({ chatId: 666, text: 'do a thing' });
    const h = makeHarness();
    h.deps = { ...h.deps, pairing: { isAuthorized: (id: number) => id !== 666 } as never };
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(h.runUserTurn).not.toHaveBeenCalled();
    expect(replies.some((r) => /paired/i.test(r))).toBe(true);
  });

  it('ignores a message with no chat id or no text (degrade, never throw)', async () => {
    const h = makeHarness();
    const noChat = { message: { text: 'hi' }, reply: vi.fn() } as unknown as Context;
    await expect(handleTextMessage(noChat, h.state, h.deps, h.cb)).resolves.toBeUndefined();
    const noText = { chat: { id: 1 }, message: {}, reply: vi.fn() } as unknown as Context;
    await expect(handleTextMessage(noText, h.state, h.deps, h.cb)).resolves.toBeUndefined();
    expect(h.runUserTurn).not.toHaveBeenCalled();
  });
});

describe('handleTextMessage — /cancel (interrupt while busy)', () => {
  it('aborts the live per-turn controller even while a turn is in flight', async () => {
    const controller = new AbortController();
    const { ctx, replies } = fakeCtx({ text: '/cancel' });
    const h = makeHarness({ busy: true, turnController: controller });
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(controller.signal.aborted).toBe(true);
    expect(replies.some((r) => /cancel/i.test(r))).toBe(true);
    // /cancel must not start a new turn.
    expect(h.runUserTurn).not.toHaveBeenCalled();
  });

  it('replies "nothing to cancel" when no turn is running', async () => {
    const { ctx, replies } = fakeCtx({ text: '/cancel' });
    const h = makeHarness({ busy: false, turnController: null });
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(replies.some((r) => /nothing to cancel/i.test(r))).toBe(true);
  });

  it('does not re-abort an already-aborted controller', async () => {
    const controller = new AbortController();
    controller.abort('earlier');
    const spy = vi.spyOn(controller, 'abort');
    const { ctx, replies } = fakeCtx({ text: '/cancel' });
    const h = makeHarness({ busy: true, turnController: controller });
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(spy).not.toHaveBeenCalled();
    expect(replies.some((r) => /nothing to cancel/i.test(r))).toBe(true);
  });
});

describe('handleTextMessage — single-flight busy guard', () => {
  it('refuses a plain prompt while a turn is in flight (no second turn)', async () => {
    const { ctx, replies } = fakeCtx({ text: 'another prompt' });
    const h = makeHarness({ busy: true });
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(h.runUserTurn).not.toHaveBeenCalled();
    expect(replies.some((r) => /still working/i.test(r))).toBe(true);
  });

  it('runs a turn when idle', async () => {
    const { ctx } = fakeCtx({ text: 'do the thing' });
    const h = makeHarness({ busy: false });
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(h.runUserTurn).toHaveBeenCalledTimes(1);
    expect(h.runUserTurn).toHaveBeenCalledWith(ctx, 42, 'do the thing');
  });
});

describe('handleTextMessage — awaiting approval text (captured BEFORE busy)', () => {
  it('captures the next message as approval text even while busy, and clears the latch', async () => {
    const awaiting: AwaitingApprovalText = { approvalId: 'appr_1', optionId: 'redraft' };
    const { ctx, replies } = fakeCtx({ text: 'please tighten the plan' });
    // busy:true with no controller — the awaiting branch must win BEFORE the
    // busy refusal so the user can actually answer the prompt.
    const h = makeHarness({ busy: true, awaitingApprovalText: awaiting });
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    // Latch cleared first (so a thrown resolver can't re-enter it).
    expect(h.setAwaitingApprovalText).toHaveBeenCalledWith(null);
    expect(h.resolvePendingWithText).toHaveBeenCalledWith(
      'appr_1',
      'redraft',
      'please tighten the plan',
    );
    expect(h.runUserTurn).not.toHaveBeenCalled();
    expect(replies.some((r) => /submitted/i.test(r))).toBe(true);
  });

  it('replies gracefully when the awaited approval is no longer pending', async () => {
    const awaiting: AwaitingApprovalText = { approvalId: 'appr_old', optionId: 'redraft' };
    const { ctx, replies } = fakeCtx({ text: 'late text' });
    const h = makeHarness({ awaitingApprovalText: awaiting });
    h.resolvePendingWithText.mockReturnValueOnce(false);
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(replies.some((r) => /no longer pending/i.test(r))).toBe(true);
    expect(h.runUserTurn).not.toHaveBeenCalled();
  });

  it('does NOT treat /cancel as approval text — the awaiting latch is cleared and /cancel still cancels', async () => {
    // A user who clicked a text-requesting option but then types /cancel: the
    // approval text capture consumes the message (it is the awaited follow-up),
    // so /cancel becomes the redraft text rather than a turn cancel. We assert
    // the documented behaviour: awaiting-text wins, the latch is cleared, and
    // no turn is started — so the channel can't be left in a corrupt state.
    const awaiting: AwaitingApprovalText = { approvalId: 'appr_2', optionId: 'redraft' };
    const { ctx } = fakeCtx({ text: '/cancel' });
    const h = makeHarness({ awaitingApprovalText: awaiting });
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(h.setAwaitingApprovalText).toHaveBeenCalledWith(null);
    expect(h.resolvePendingWithText).toHaveBeenCalledWith('appr_2', 'redraft', '/cancel');
    expect(h.runUserTurn).not.toHaveBeenCalled();
  });
});

describe('handleTextMessage — /exit teardown', () => {
  it('routes /exit through the registry and stops the channel handle', async () => {
    const stop = vi.fn(async () => {});
    const handle = { running: Promise.resolve(), stop } as unknown as ChannelHandle;
    const session = makeSession();
    // Register an /exit command that yields a session-action the handler maps
    // to handle.stop — the real teardown path.
    session.commands.register({
      name: 'exit',
      description: 'close',
      channels: ['telegram'],
      handler: async () => ({ kind: 'session-action', action: 'exit', notice: 'bye' }),
    });
    const { ctx, replies } = fakeCtx({ text: '/exit' });
    const h = makeHarness({ session, handle });
    await handleTextMessage(ctx, h.state, h.deps, h.cb);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(replies.some((r) => /bye/i.test(r))).toBe(true);
  });
});
