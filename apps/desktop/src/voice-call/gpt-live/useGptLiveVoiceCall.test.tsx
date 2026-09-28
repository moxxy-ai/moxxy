import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import type {
  GptLiveConnectOptions,
  GptLiveConnection,
  GptLiveTransport,
} from './gpt-live-transport';
import { useGptLiveVoiceCall } from './useGptLiveVoiceCall';

// Two boundaries are stood in: desktop IPC to the main process (which owns the
// OAuth token and the runner) and the browser WebRTC transport. The hook, the
// protocol parser, exchange pairing and chat mirroring all run for real.
type PushHandler = (payload: never) => void;

function createApi(options: { readonly authenticated?: boolean; readonly recordError?: string } = {}) {
  const subscribers = new Map<string, Set<PushHandler>>();
  const invoke = vi.fn(async (channel: string, _args?: unknown) => {
    if (channel === 'voice.live.preflight') return { authenticated: options.authenticated ?? true };
    if (channel === 'voice.live.start') return { sdp: 'v=0\r\no=answer\r\n', callId: 'rtc_1' };
    if (channel === 'session.recordVoiceExchange') {
      if (options.recordError) throw new Error(options.recordError);
      return undefined;
    }
    throw new Error(`unexpected ${channel}`);
  });
  const api = {
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: ((channel: string, handler: PushHandler) => {
      const listeners = subscribers.get(channel) ?? new Set<PushHandler>();
      subscribers.set(channel, listeners);
      listeners.add(handler);
      return () => listeners.delete(handler);
    }) as MoxxyApi['subscribe'],
  };
  return {
    api,
    invoke,
    emit(channel: string, payload: unknown): void {
      for (const handler of subscribers.get(channel) ?? []) handler(payload as never);
    },
  };
}

class InMemoryGptLiveTransport implements GptLiveTransport {
  options: GptLiveConnectOptions | null = null;
  readonly sent: unknown[] = [];
  muted = false;
  closed = false;

  async connect(options: GptLiveConnectOptions): Promise<GptLiveConnection> {
    this.options = options;
    const answer = await options.negotiate('v=0\r\no=offer\r\n');
    return {
      callId: answer.callId,
      send: (payload) => { this.sent.push(payload); },
      setMuted: (muted) => { this.muted = muted; },
      close: () => { this.closed = true; },
    };
  }

  receive(event: unknown): void {
    this.options?.onEvent(JSON.stringify(event));
  }
}

function turnDone(role: 'user' | 'assistant', transcript: string, id = `turn_${role}_${transcript.length}`) {
  return { type: 'turn.done', turn: { id, role, transcript } };
}

function runnerEvent(turnId: string, body: Record<string, unknown>): MoxxyEvent {
  return {
    id: asEventId(`event-${turnId}-${String(body.type)}`),
    seq: 1,
    ts: 1,
    sessionId: asSessionId('session-1'),
    turnId: asTurnId(turnId),
    ...body,
  } as MoxxyEvent;
}

async function openCall(
  authenticated = true,
  recordError?: string,
  send: (prompt: string) => Promise<void> = async () => undefined,
) {
  const ipc = createApi({ authenticated, ...(recordError ? { recordError } : {}) });
  __setApiOverride(ipc.api);
  const transport = new InMemoryGptLiveTransport();
  const chat = { sending: false, activeTurnId: null, error: null, send: vi.fn(send) };
  const hook = renderHook(
    ({ inputRequired }: { inputRequired: boolean }) => useGptLiveVoiceCall({
      workspaceId: 'workspace-1',
      ready: true,
      chat,
      inputRequired,
      transport,
    }),
    { initialProps: { inputRequired: false } },
  );
  act(() => hook.result.current.open());
  return { ipc, transport, hook, chat };
}

function delegate(transport: InMemoryGptLiveTransport, userTurnId: string, paraphrase: string): void {
  act(() => transport.receive({
    type: 'delegation.created',
    item: {
      id: 'item_1',
      type: 'delegation',
      target: 'client',
      content: [{ type: 'input_text', text: paraphrase }],
      user_bidi_turn_id: userTurnId,
    },
  }));
}

function speakableResults(transport: InMemoryGptLiveTransport): string[] {
  return transport.sent
    .filter((message): message is { type: string; channel: string; content: Array<{ text: string }> } =>
      (message as { type?: string }).type === 'delegation.context.append')
    .map((message) => message.content.map((part) => part.text).join(''));
}

afterEach(() => {
  __setApiOverride(null);
});

describe('useGptLiveVoiceCall', () => {
  it('opens a GPT-Live call for the workspace and starts listening', async () => {
    const { ipc, hook } = await openCall();

    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    expect(hook.result.current.active).toBe(true);
    expect(ipc.invoke).toHaveBeenCalledWith('voice.live.start', {
      workspaceId: 'workspace-1',
      sdp: 'v=0\r\no=offer\r\n',
    });
  });

  it('asks for the ChatGPT login instead of connecting when it is missing', async () => {
    const { transport, hook } = await openCall(false);

    await waitFor(() => expect(hook.result.current.phase).toBe('error'));
    expect(hook.result.current.errorReason).toMatch(/Sign in with ChatGPT/);
    expect(transport.options).toBeNull();
  });

  it('follows the conversation and records every spoken exchange in the chat', async () => {
    const { ipc, transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    act(() => transport.receive(turnDone('user', ' Jaka jest stolica Francji?')));
    expect(hook.result.current.lastTranscript).toBe('Jaka jest stolica Francji?');
    act(() => transport.receive({ type: 'turn.created', turn: { id: 't2', role: 'assistant', transcript: 'Sto' } }));
    expect(hook.result.current.phase).toBe('speaking');
    act(() => transport.receive(turnDone('assistant', ' Stolicą Francji jest Paryż.')));

    expect(hook.result.current.phase).toBe('listening');
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('session.recordVoiceExchange', {
      workspaceId: 'workspace-1',
      userText: 'Jaka jest stolica Francji?',
      assistantText: 'Stolicą Francji jest Paryż.',
    }));
  });

  it('keeps the model current with the chat without echoing its own exchanges', async () => {
    const { ipc, transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    act(() => transport.receive(turnDone('user', 'Halo?')));
    act(() => transport.receive(turnDone('assistant', 'Słucham.')));
    transport.sent.length = 0;

    act(() => {
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('voice', { type: 'user_prompt', source: 'user', text: 'Halo?' }),
      });
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('typed', { type: 'user_prompt', source: 'user', text: 'Mój kolor to zielony.' }),
      });
      ipc.emit('runner.event', {
        workspaceId: 'other-workspace',
        event: runnerEvent('elsewhere', { type: 'user_prompt', source: 'user', text: 'Nie ten czat.' }),
      });
    });

    expect(transport.sent).toEqual([{
      type: 'session.context.append',
      channel: 'developer',
      content: [{ type: 'input_text', text: 'The user wrote in the Moxxy chat: Mój kolor to zielony.' }],
    }]);
  });

  it('hands an explicit task to the agent in the user\'s own words and reads back the real result', async () => {
    const { ipc, transport, hook, chat } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    delegate(transport, 'turn_u1', 'run the project tests');
    expect(chat.send).not.toHaveBeenCalled();
    act(() => transport.receive(turnDone('user', ' Uruchom testy w projekcie.', 'turn_u1')));

    expect(chat.send).toHaveBeenCalledWith('Uruchom testy w projekcie.');
    expect(hook.result.current.phase).toBe('working');
    act(() => transport.receive(turnDone('assistant', 'Jasne, już to przekazuję.')));
    expect(hook.result.current.phase).toBe('working');
    expect(speakableResults(transport)).toEqual([]);

    act(() => {
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('agent_turn', { type: 'user_prompt', source: 'user', text: 'Uruchom testy w projekcie.' }),
      });
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('agent_turn', {
          type: 'assistant_message',
          source: 'model',
          content: 'Wszystkie testy przeszły.',
          stopReason: 'end_turn',
        }),
      });
      ipc.emit('runner.turn.complete', { workspaceId: 'workspace-1', turnId: 'agent_turn', error: null });
    });

    expect(speakableResults(transport)).toEqual([
      'The Moxxy agent finished. Its reply: Wszystkie testy przeszły.',
    ]);
    expect(transport.sent).not.toContainEqual(expect.objectContaining({ channel: 'developer' }));
    expect(ipc.invoke).not.toHaveBeenCalledWith('session.recordVoiceExchange', expect.anything());
  });

  it('keeps the voice record for conversation it answers itself while a task runs', async () => {
    const { ipc, transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    delegate(transport, 'turn_u1', 'run tests');
    act(() => transport.receive(turnDone('user', 'Uruchom testy.', 'turn_u1')));

    act(() => transport.receive(turnDone('user', 'Jaka jest stolica Francji?', 'turn_u2')));
    act(() => transport.receive(turnDone('assistant', 'Paryż.')));

    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('session.recordVoiceExchange', {
      workspaceId: 'workspace-1',
      userText: 'Jaka jest stolica Francji?',
      assistantText: 'Paryż.',
    }));
    expect(hook.result.current.phase).toBe('working');
  });

  it('reports a task the agent could not even start', async () => {
    const { transport, hook } = await openCall(true, undefined, async () => {
      throw new Error('runner not connected');
    });
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    delegate(transport, 'turn_u1', 'deploy');
    act(() => transport.receive(turnDone('user', 'Zrób deploy.', 'turn_u1')));

    await waitFor(() => expect(speakableResults(transport)).toEqual([
      'The Moxxy agent could not finish the task: runner not connected',
    ]));
  });

  it('tells GPT-Live when the agent is waiting for an approval on screen', async () => {
    const { transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    delegate(transport, 'turn_u1', 'edit file');
    act(() => transport.receive(turnDone('user', 'Popraw plik README.', 'turn_u1')));

    hook.rerender({ inputRequired: true });

    expect(hook.result.current.phase).toBe('waiting-for-input');
    expect(transport.sent).toContainEqual(expect.objectContaining({
      channel: 'developer',
      content: [expect.objectContaining({ text: expect.stringMatching(/approv/i) })],
    }));
  });

  it('mutes the microphone and pauses', async () => {
    const { transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    act(() => hook.result.current.muteMicrophone());
    expect(transport.muted).toBe(true);
    expect(hook.result.current.phase).toBe('paused');

    act(() => hook.result.current.unmuteMicrophone());
    expect(transport.muted).toBe(false);
    expect(hook.result.current.phase).toBe('listening');
  });

  it('closes the session and keeps speech the model never answered', async () => {
    const { ipc, transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    act(() => transport.receive(turnDone('user', 'Halo, jesteś tam?')));

    act(() => hook.result.current.close());

    expect(transport.sent).toContainEqual({ type: 'session.close' });
    expect(transport.closed).toBe(true);
    expect(hook.result.current.active).toBe(false);
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('session.recordVoiceExchange', {
      workspaceId: 'workspace-1',
      userText: 'Halo, jesteś tam?',
    }));
  });

  it('stops instead of silently losing the conversation when the chat cannot record it', async () => {
    const { transport, hook } = await openCall(true, 'Recording a voice conversation requires runner protocol v16');
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    act(() => transport.receive(turnDone('user', 'Halo?')));
    act(() => transport.receive(turnDone('assistant', 'Słucham.')));

    await waitFor(() => expect(hook.result.current.phase).toBe('error'));
    expect(hook.result.current.errorReason).toMatch(/save.*chat.*protocol v16/i);
    expect(transport.closed).toBe(true);
  });

  it('surfaces a session the service ended', async () => {
    const { transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    act(() => transport.receive({ type: 'session.closed', reason: 'usage_limit_reached' }));

    expect(hook.result.current.phase).toBe('error');
    expect(hook.result.current.errorReason).toMatch(/usage_limit_reached/);
    expect(transport.closed).toBe(true);
  });
});
