import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride, chatStore } from '@moxxy/client-core';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { useReplySound } from './useReplySound';
import { __resetReplySoundForTests, setReplySoundPreference } from './useReplySoundPreference';

/**
 * The chat store is the real one. What is stood in for is outside the window:
 * the main process behind IPC, and the speaker (`ring`).
 */

const desk = (id: string, sessions: string[]): Desk =>
  ({ id, name: id, sessions: sessions.map((session) => ({ id: session, name: session })) }) as unknown as Desk;

const DESKS = [desk('moxxy', ['a', 'b']), desk('site', ['c'])];

function Probe({ desks, onScreen, ring }: { desks: ReadonlyArray<Desk>; onScreen: string | null; ring: () => void }): null {
  useReplySound({ desks, onScreenId: onScreen, ring });
  return null;
}

const start = (id: string, turnId: string): void => act(() => chatStore.dispatch(id, { type: 'send_started', turnId }));
const finish = (id: string, turnId: string): void =>
  act(() => chatStore.dispatch(id, { type: 'turn_complete', turnId, error: null }));

beforeEach(() => {
  __setApiOverride({ invoke: async () => ({}), subscribe: () => () => undefined } as never);
});

afterEach(() => {
  cleanup();
  for (const id of ['a', 'b', 'c']) chatStore.drop(id);
  __resetReplySoundForTests();
  __setApiOverride(null);
});

describe('useReplySound', () => {
  it('rings once when another chat finishes its answer', () => {
    const ring = vi.fn();
    render(<Probe desks={DESKS} onScreen="a" ring={ring} />);

    start('b', 't1');
    expect(ring).not.toHaveBeenCalled();
    finish('b', 't1');

    expect(ring).toHaveBeenCalledTimes(1);
  });

  it('stays silent for the chat on screen', () => {
    const ring = vi.fn();
    render(<Probe desks={DESKS} onScreen="a" ring={ring} />);

    start('a', 't1');
    finish('a', 't1');

    expect(ring).not.toHaveBeenCalled();
  });

  it('rings once for two chats that finish together', () => {
    const ring = vi.fn();
    render(<Probe desks={DESKS} onScreen="a" ring={ring} />);

    start('b', 't1');
    start('c', 't2');
    act(() => {
      chatStore.dispatch('b', { type: 'turn_complete', turnId: 't1', error: null });
      chatStore.dispatch('c', { type: 'turn_complete', turnId: 't2', error: null });
    });

    expect(ring).toHaveBeenCalledTimes(1);
  });

  it('does not ring between an answer and the queued message that follows it at once', () => {
    const ring = vi.fn();
    render(<Probe desks={DESKS} onScreen="a" ring={ring} />);

    start('b', 't1');
    act(() => {
      chatStore.dispatch('b', { type: 'turn_complete', turnId: 't1', error: null });
      chatStore.dispatch('b', { type: 'send_started', turnId: 't2' });
    });
    expect(ring).not.toHaveBeenCalled();

    finish('b', 't2');
    expect(ring).toHaveBeenCalledTimes(1);
  });

  it('rings for a chat the person left while it was answering', () => {
    const ring = vi.fn();
    const view = render(<Probe desks={DESKS} onScreen="b" ring={ring} />);

    start('b', 't1');
    view.rerender(<Probe desks={DESKS} onScreen="a" ring={ring} />);
    finish('b', 't1');

    expect(ring).toHaveBeenCalledTimes(1);
  });

  it('stays silent for a chat that was removed while it answered', () => {
    const ring = vi.fn();
    const view = render(<Probe desks={DESKS} onScreen="a" ring={ring} />);

    start('c', 't1');
    view.rerender(<Probe desks={[desk('moxxy', ['a', 'b'])]} onScreen="a" ring={ring} />);

    expect(ring).not.toHaveBeenCalled();
  });

  it('stays silent once the sound is switched off', () => {
    const ring = vi.fn();
    render(<Probe desks={DESKS} onScreen="a" ring={ring} />);
    act(() => setReplySoundPreference(false));

    start('b', 't1');
    finish('b', 't1');

    expect(ring).not.toHaveBeenCalled();
  });
});
