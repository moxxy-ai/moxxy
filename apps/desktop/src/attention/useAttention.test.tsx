import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride, askStore, chatStore } from '@moxxy/client-core';
import type { AppPresence, AskRequest, Desk } from '@moxxy/desktop-ipc-contract';
import type { Banner } from './show-banner';
import { useAttention } from './useAttention';
import { __resetReplySoundForTests, setReplySoundPreference } from './useReplySoundPreference';
import {
  __resetSystemNotificationsForTests,
  setSystemNotificationsPreference,
} from './useSystemNotificationsPreference';

/**
 * The chat store and the ask store are the real ones. What is stood in for is
 * outside the window: the main process behind IPC (it alone knows which of the
 * app's windows has the keyboard), the speaker (`ring`) and the system's
 * notification centre (`show`).
 */

const desk = (id: string, sessions: string[]): Desk =>
  ({ id, name: id, sessions: sessions.map((session) => ({ id: session, name: `Chat ${session}` })) }) as unknown as Desk;

const DESKS = [desk('moxxy', ['a', 'b']), desk('site', ['c'])];

const IN_MAIN: AppPresence = { focused: 'main', widgetOpen: false };
const AWAY: AppPresence = { focused: null, widgetOpen: false };

let presence: AppPresence;

interface ProbeProps {
  readonly desks?: ReadonlyArray<Desk>;
  readonly mainChatId?: string | null;
  readonly activeId?: string | null;
  readonly ring: () => void;
  readonly show?: (banner: Banner) => void;
  readonly onOpen?: (sessionId: string) => void;
}

function Probe({ desks = DESKS, mainChatId = 'a', activeId = 'a', ring, show = () => undefined, onOpen = () => undefined }: ProbeProps): null {
  useAttention({ desks, mainChatId, activeId, onOpen, ring, show });
  return null;
}

const start = (id: string, turnId: string): void => act(() => chatStore.dispatch(id, { type: 'send_started', turnId }));
const finish = (id: string, turnId: string): void =>
  act(() => chatStore.dispatch(id, { type: 'turn_complete', turnId, error: null }));
/** The ask store never shows a request id twice, so every question gets its own. */
let asked = 0;
function ask(id: string): string {
  const requestId = `request-${(asked += 1)}`;
  act(() => askStore.add({ requestId, workspaceId: id, kind: 'permission', tool: { name: 'Bash', input: {} } } as AskRequest));
  return requestId;
}
/** Lets the window hear back from the main process. */
const settle = (): Promise<void> => act(async () => undefined);

beforeEach(() => {
  presence = IN_MAIN;
  __setApiOverride({
    invoke: async (name: string) => (name === 'window.presence' ? presence : {}),
    subscribe: () => () => undefined,
  } as never);
});

afterEach(() => {
  cleanup();
  for (const id of ['a', 'b', 'c']) chatStore.drop(id);
  for (const pending of askStore.getAll()) askStore.resolve(pending.requestId);
  __resetReplySoundForTests();
  __resetSystemNotificationsForTests();
  __setApiOverride(null);
});

describe('useAttention', () => {
  it('rings once when another chat finishes its answer', async () => {
    const ring = vi.fn();
    render(<Probe ring={ring} />);

    start('b', 't1');
    await settle();
    expect(ring).not.toHaveBeenCalled();
    finish('b', 't1');

    await waitFor(() => expect(ring).toHaveBeenCalledTimes(1));
  });

  it('stays silent for the chat being read', async () => {
    const ring = vi.fn();
    render(<Probe ring={ring} />);

    start('a', 't1');
    finish('a', 't1');
    await settle();

    expect(ring).not.toHaveBeenCalled();
  });

  it('rings once for two chats that finish together', async () => {
    const ring = vi.fn();
    render(<Probe ring={ring} />);

    start('b', 't1');
    start('c', 't2');
    act(() => {
      chatStore.dispatch('b', { type: 'turn_complete', turnId: 't1', error: null });
      chatStore.dispatch('c', { type: 'turn_complete', turnId: 't2', error: null });
    });
    await settle();

    expect(ring).toHaveBeenCalledTimes(1);
  });

  it('does not ring between an answer and the queued message that follows it at once', async () => {
    const ring = vi.fn();
    render(<Probe ring={ring} />);

    start('b', 't1');
    act(() => {
      chatStore.dispatch('b', { type: 'turn_complete', turnId: 't1', error: null });
      chatStore.dispatch('b', { type: 'send_started', turnId: 't2' });
    });
    await settle();
    expect(ring).not.toHaveBeenCalled();

    finish('b', 't2');
    await waitFor(() => expect(ring).toHaveBeenCalledTimes(1));
  });

  it('rings for a chat the person left while it was answering', async () => {
    const ring = vi.fn();
    const view = render(<Probe ring={ring} mainChatId="b" activeId="b" />);

    start('b', 't1');
    view.rerender(<Probe ring={ring} mainChatId="a" activeId="a" />);
    finish('b', 't1');

    await waitFor(() => expect(ring).toHaveBeenCalledTimes(1));
  });

  it('stays silent for a chat that was removed while it answered', async () => {
    const ring = vi.fn();
    const view = render(<Probe ring={ring} />);

    start('c', 't1');
    view.rerender(<Probe ring={ring} desks={[desk('moxxy', ['a', 'b'])]} />);
    await settle();

    expect(ring).not.toHaveBeenCalled();
  });

  it('stays silent once the sound is switched off', async () => {
    const ring = vi.fn();
    render(<Probe ring={ring} />);
    act(() => setReplySoundPreference(false));

    start('b', 't1');
    finish('b', 't1');
    await settle();

    expect(ring).not.toHaveBeenCalled();
  });

  it('rings when another chat stops to ask, though its turn is still open', async () => {
    const ring = vi.fn();
    render(<Probe ring={ring} />);

    start('b', 't1');
    ask('b');

    await waitFor(() => expect(ring).toHaveBeenCalledTimes(1));
  });

  it('rings once per question, not again while it waits, and again when the answer lands', async () => {
    const ring = vi.fn();
    render(<Probe ring={ring} />);

    start('b', 't1');
    const question = ask('b');
    await waitFor(() => expect(ring).toHaveBeenCalledTimes(1));
    act(() => askStore.resolve(question));
    await settle();
    expect(ring).toHaveBeenCalledTimes(1);

    finish('b', 't1');
    await waitFor(() => expect(ring).toHaveBeenCalledTimes(2));
  });

  it('stays silent when the chat being read asks: the sheet is in front of the person', async () => {
    const ring = vi.fn();
    render(<Probe ring={ring} />);

    start('a', 't1');
    ask('a');
    await settle();

    expect(ring).not.toHaveBeenCalled();
  });

  it('rings for the chat on screen once the app is in the background, and shows a banner', async () => {
    presence = AWAY;
    const ring = vi.fn();
    const show = vi.fn();
    render(<Probe ring={ring} show={show} />);

    start('a', 't1');
    act(() =>
      chatStore.dispatch('a', {
        type: 'event',
        event: { type: 'assistant_message', content: 'Bake for 20 minutes.', id: 'e1', seq: 1, ts: 0, turnId: 't1' },
      } as never),
    );
    finish('a', 't1');

    await waitFor(() => expect(ring).toHaveBeenCalledTimes(1));
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]?.[0]).toMatchObject({ title: 'Chat a', body: 'Bake for 20 minutes.', tag: 'a' });
  });

  it('shows a banner that a chat is waiting when it asks in the background', async () => {
    presence = AWAY;
    const show = vi.fn();
    render(<Probe ring={() => undefined} show={show} />);

    start('b', 't1');
    ask('b');

    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    expect(show.mock.calls[0]?.[0]).toMatchObject({ title: 'Chat b', body: 'Waiting for your decision.', tag: 'b' });
  });

  it('opens the chat a clicked banner belongs to', async () => {
    presence = AWAY;
    const show = vi.fn();
    const onOpen = vi.fn();
    render(<Probe ring={() => undefined} show={show} onOpen={onOpen} />);

    start('c', 't1');
    finish('c', 't1');
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
    (show.mock.calls[0]?.[0] as Banner).onOpen();

    expect(onOpen).toHaveBeenCalledWith('c');
  });

  it('shows no banner while the app has the keyboard, or once banners are switched off', async () => {
    const ring = vi.fn();
    const show = vi.fn();
    render(<Probe ring={ring} show={show} />);

    start('b', 't1');
    finish('b', 't1');
    await waitFor(() => expect(ring).toHaveBeenCalledTimes(1));
    expect(show).not.toHaveBeenCalled();

    presence = AWAY;
    act(() => setSystemNotificationsPreference(false));
    start('b', 't2');
    finish('b', 't2');
    await waitFor(() => expect(ring).toHaveBeenCalledTimes(2));
    expect(show).not.toHaveBeenCalled();
  });

  it('falls back to "the app is in front" when the main process cannot be asked', async () => {
    __setApiOverride({
      invoke: async (name: string) => {
        if (name === 'window.presence') throw new Error('no handler');
        return {};
      },
      subscribe: () => () => undefined,
    } as never);
    const ring = vi.fn();
    const show = vi.fn();
    render(<Probe ring={ring} show={show} />);

    start('a', 't1');
    finish('a', 't1');
    start('b', 't2');
    finish('b', 't2');

    await waitFor(() => expect(ring).toHaveBeenCalledTimes(1));
    expect(show).not.toHaveBeenCalled();
  });
});
