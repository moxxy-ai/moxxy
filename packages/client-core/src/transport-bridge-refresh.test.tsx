import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcEvents, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import type { MoxxyEvent } from '@moxxy/sdk';

import { configureTransport } from './transport.js';
import { ChatStoreBridge } from './useChat.js';
import { chatStore } from './chatStore.js';
import { askStore } from './askStore.js';
import { ConnectionBridge, connectionStore } from './useConnection.js';

type EventHandler<K extends keyof IpcEvents> = (payload: IpcEvents[K]) => void;

function fakeApi(workspaceId: string): {
  api: MoxxyApi;
  emit: <K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]) => void;
  invoke: ReturnType<typeof vi.fn>;
  subscriptions: Map<keyof IpcEvents, Set<EventHandler<keyof IpcEvents>>>;
} {
  const subscriptions = new Map<keyof IpcEvents, Set<EventHandler<keyof IpcEvents>>>();
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === 'connection.snapshotAll') {
      return [
        {
          workspaceId,
          phase: {
            phase: 'connected',
            socket: '',
            sessionId: workspaceId,
            activeProvider: 'openai-codex',
            activeMode: 'default',
          },
          cliPath: null,
          attempts: 0,
          log: [],
        },
      ];
    }
    if (cmd === 'connection.activeWorkspace') return workspaceId;
    if (cmd === 'chat.append') return undefined;
    if (cmd === 'chat.migrate') return undefined;
    throw new Error(`unexpected ${cmd}`);
  });
  const api: MoxxyApi = {
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: ((channel: keyof IpcEvents, handler: EventHandler<keyof IpcEvents>) => {
      let handlers = subscriptions.get(channel);
      if (!handlers) {
        handlers = new Set();
        subscriptions.set(channel, handlers);
      }
      handlers.add(handler);
      return () => {
        handlers?.delete(handler);
      };
    }) as MoxxyApi['subscribe'],
  };
  return {
    api,
    emit: (channel, payload) => {
      subscriptions.get(channel)?.forEach((handler) => handler(payload));
    },
    invoke,
    subscriptions,
  };
}

function userPrompt(workspaceId: string, id: string, text: string): MoxxyEvent {
  return {
    id,
    type: 'user_prompt',
    text,
    ts: 1,
    seq: 1,
    turnId: `${id}-turn`,
    sessionId: workspaceId,
    source: 'user',
  };
}

afterEach(() => {
  act(() => {
    connectionStore.setActive(null);
  });
});

describe('client bridges after transport replacement', () => {
  it('re-primes connection snapshots from the newly configured transport', async () => {
    const first = fakeApi('session-old');
    configureTransport(first.api);
    render(<ConnectionBridge />);

    await waitFor(() => expect(connectionStore.active$()).toBe('session-old'));

    const second = fakeApi('session-new');
    act(() => {
      configureTransport(second.api);
    });

    await waitFor(() => expect(connectionStore.active$()).toBe('session-new'));
    expect(second.invoke).toHaveBeenCalledWith('connection.snapshotAll');
  });

  it('re-subscribes chat events on the newly configured transport', async () => {
    const first = fakeApi('chat-old');
    configureTransport(first.api);
    render(<ChatStoreBridge />);

    const second = fakeApi('chat-new');
    act(() => {
      configureTransport(second.api);
    });

    act(() => {
      second.emit('runner.event', {
        workspaceId: 'chat-new',
        event: userPrompt('chat-new', 'event-new', 'hello from new transport'),
      });
    });

    await waitFor(() =>
      expect(chatStore.getChat('chat-new').events).toEqual([
        expect.objectContaining({ id: 'event-new', text: 'hello from new transport' }),
      ]),
    );
    expect(second.subscriptions.get('runner.event')?.size).toBe(1);
  });

  it('mirrors shared turn starts so every attached client shows thinking state', async () => {
    const bridge = fakeApi('turn-sync');
    configureTransport(bridge.api);
    render(<ChatStoreBridge />);

    act(() => {
      bridge.emit('runner.turn.started', { workspaceId: 'turn-sync', turnId: 'turn-1' });
    });

    await waitFor(() => {
      const snap = chatStore.getChat('turn-sync');
      expect(snap.sending).toBe(true);
      expect(snap.activeTurnId).toBe('turn-1');
    });

    act(() => {
      bridge.emit('runner.turn.complete', {
        workspaceId: 'turn-sync',
        turnId: 'turn-1',
        error: null,
      });
    });

    await waitFor(() => expect(chatStore.getChat('turn-sync').sending).toBe(false));
  });

  it('drops permission prompts resolved by another attached client', async () => {
    const bridge = fakeApi('ask-sync');
    configureTransport(bridge.api);
    render(<ChatStoreBridge />);

    act(() => {
      bridge.emit('ask.request', {
        requestId: 'ask-sync-1',
        workspaceId: 'ask-sync',
        kind: 'permission',
        tool: { name: 'Write', input: {} },
      });
    });

    await waitFor(() =>
      expect(askStore.getAll().some((ask) => ask.requestId === 'ask-sync-1')).toBe(true),
    );

    act(() => {
      bridge.emit('ask.resolved', { workspaceId: 'ask-sync', requestId: 'ask-sync-1' });
    });

    await waitFor(() =>
      expect(askStore.getAll().some((ask) => ask.requestId === 'ask-sync-1')).toBe(false),
    );
  });

  it('mirrors shared model selection changes into the local chat store', async () => {
    const bridge = fakeApi('model-sync');
    configureTransport(bridge.api);
    render(<ChatStoreBridge />);

    act(() => {
      bridge.emit('session.model.changed', { workspaceId: 'model-sync', model: 'gpt-5.4' });
    });

    await waitFor(() => expect(chatStore.getModel('model-sync')).toBe('gpt-5.4'));
  });
});
