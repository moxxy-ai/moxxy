import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride, type VoiceCallChat } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import type {
  GptLiveConnectOptions,
  GptLiveConnection,
  GptLiveTransport,
} from './gpt-live-transport';
import { useGptLiveVoiceCall } from './useGptLiveVoiceCall';

// Two boundaries are stood in: desktop IPC to the main process (which owns the
// OpenAI API key and the runner) and the browser WebRTC transport. The hook, the
// protocol parser, exchange pairing and chat mirroring all run for real.
type PushHandler = (payload: never) => void;

function createApi(options: { readonly authenticated?: boolean; readonly recordError?: string } = {}) {
  const subscribers = new Map<string, Set<PushHandler>>();
  const invoke = vi.fn(async (channel: string, _args?: unknown) => {
    if (channel === 'voice.live.preflight') return { authenticated: options.authenticated ?? true };
    if (channel === 'voice.live.start') return { sdp: 'v=0\r\no=answer\r\n', callId: 'live_1' };
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

/** One spoken fragment, as the Live API streams it. A turn ends when the other
 *  side speaks, a delegation arrives, or the model goes quiet (`quiet()`). */
function said(role: 'user' | 'assistant', delta: string) {
  return {
    type: role === 'user' ? 'session.input_transcript.delta' : 'session.output_transcript.delta',
    event_id: `evt_${role}_${delta.length}`,
    delta,
    start_ms: 0,
    end_ms: 100,
  };
}

/** Let the model's quiet window (0 ms in these tests) end its turn. */
async function quiet(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
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
  const chat: VoiceCallChat = { sending: false, activeTurnId: null, error: null, send: vi.fn(send) };
  const hook = renderHook(
    (props: { inputRequired: boolean; chat: VoiceCallChat }) => useGptLiveVoiceCall({
      workspaceId: 'workspace-1',
      ready: true,
      chat: props.chat,
      inputRequired: props.inputRequired,
      transport,
      speechQuietMs: 0,
    }),
    { initialProps: { inputRequired: false, chat } },
  );
  act(() => hook.result.current.open());
  return { ipc, transport, hook, chat };
}

function delegate(transport: InMemoryGptLiveTransport, itemId = 'del_1'): void {
  act(() => transport.receive({
    type: 'session.delegation.created',
    event_id: `evt_${itemId}`,
    offset_ms: 3600,
    delegation: { id: itemId, type: 'delegation', target: 'client' },
  }));
}

function sentOfType(transport: InMemoryGptLiveTransport, type: string): Array<{ delegation_id: string | null; content: string }> {
  return transport.sent.filter((message): message is {
    type: string;
    delegation_id: string | null;
    content: string;
  } => (message as { type?: string }).type === type);
}

function speakableResults(transport: InMemoryGptLiveTransport, itemId?: string): string[] {
  return sentOfType(transport, 'session.commentary.append')
    .filter((message) => !itemId || message.delegation_id === itemId)
    .map((message) => message.content);
}

function finishAgentTurn(
  ipc: ReturnType<typeof createApi>,
  turnId: string,
  promptText: string,
  replyText: string,
): void {
  act(() => {
    ipc.emit('runner.event', {
      workspaceId: 'workspace-1',
      event: runnerEvent(turnId, { type: 'user_prompt', source: 'user', text: promptText }),
    });
    ipc.emit('runner.event', {
      workspaceId: 'workspace-1',
      event: runnerEvent(turnId, { type: 'assistant_message', source: 'model', content: replyText, stopReason: 'end_turn' }),
    });
    ipc.emit('runner.turn.complete', { workspaceId: 'workspace-1', turnId, error: null });
  });
}

afterEach(() => {
  // Unmount while the IPC stand-in is still installed: closing a call talks to it.
  cleanup();
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

  it('asks for the OpenAI API key instead of connecting when it is missing', async () => {
    const { transport, hook } = await openCall(false);

    await waitFor(() => expect(hook.result.current.phase).toBe('error'));
    expect(hook.result.current.errorReason).toMatch(/OpenAI API key.*Settings → Voice/);
    expect(transport.options).toBeNull();
  });

  it('follows the conversation and records every spoken exchange in the chat', async () => {
    const { ipc, transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    act(() => transport.receive(said('user', ' Jaka jest')));
    act(() => transport.receive(said('user', ' stolica Francji?')));
    act(() => transport.receive(said('assistant', 'Stolicą')));
    expect(hook.result.current.lastTranscript).toBe('Jaka jest stolica Francji?');
    expect(hook.result.current.phase).toBe('speaking');
    act(() => transport.receive(said('assistant', ' Francji jest Paryż.')));
    await quiet();

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
    act(() => transport.receive(said('user', 'Halo?')));
    act(() => transport.receive(said('assistant', 'Słucham.')));
    await quiet();
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
      type: 'session.thinking.append',
      delegation_id: null,
      content: 'The user wrote in the Moxxy chat: Mój kolor to zielony.',
    }]);
  });

  it('hands an explicit task to the agent in the user\'s own words and reads back the real result', async () => {
    const { ipc, transport, hook, chat } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    act(() => transport.receive(said('user', ' Uruchom testy w projekcie.')));
    expect(chat.send).not.toHaveBeenCalled();
    delegate(transport);

    expect(chat.send).toHaveBeenCalledWith('Uruchom testy w projekcie.');
    expect(hook.result.current.phase).toBe('working');
    act(() => transport.receive(said('assistant', 'Jasne, już to przekazuję.')));
    await quiet();
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
    expect(sentOfType(transport, 'session.thinking.append')).toEqual([]);
    expect(ipc.invoke).not.toHaveBeenCalledWith('session.recordVoiceExchange', expect.anything());
  });

  it('keeps the voice record for conversation it answers itself while a task runs', async () => {
    const { ipc, transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    act(() => transport.receive(said('user', 'Uruchom testy.')));
    delegate(transport);

    act(() => transport.receive(said('user', 'Jaka jest stolica Francji?')));
    act(() => transport.receive(said('assistant', 'Paryż.')));
    await quiet();

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

    act(() => transport.receive(said('user', 'Zrób deploy.')));
    delegate(transport);

    await waitFor(() => expect(speakableResults(transport)).toEqual([
      'The Moxxy agent could not finish the task: runner not connected',
    ]));
  });

  it('tells GPT-Live when the agent is waiting for an approval on screen', async () => {
    const { transport, hook, chat } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    act(() => transport.receive(said('user', 'Popraw plik README.')));
    delegate(transport);

    hook.rerender({ inputRequired: true, chat });

    expect(hook.result.current.phase).toBe('waiting-for-input');
    expect(sentOfType(transport, 'session.thinking.append')).toContainEqual(expect.objectContaining({
      content: expect.stringMatching(/approv/i),
    }));
  });

  it('refuses a new task while the agent is still working on one, and never runs it later', async () => {
    const { ipc, transport, hook, chat } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    act(() => transport.receive(said('user', 'Uruchom testy.')));
    delegate(transport, 'item_1');

    act(() => transport.receive(said('user', 'Zrób deploy.')));
    delegate(transport, 'item_2');

    expect(chat.send).toHaveBeenCalledTimes(1);
    expect(speakableResults(transport, 'item_2')).toEqual([expect.stringMatching(/Not started.*must finish/i)]);
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('session.recordVoiceExchange', {
      workspaceId: 'workspace-1',
      userText: 'Zrób deploy.',
      assistantText: 'Not started: the Moxxy agent was still working on another task.',
    }));

    finishAgentTurn(ipc, 'agent_1', 'Uruchom testy.', 'Testy przeszły.');

    expect(speakableResults(transport, 'item_1')).toEqual(['The Moxxy agent finished. Its reply: Testy przeszły.']);
    expect(chat.send).toHaveBeenCalledTimes(1);
    expect(hook.result.current.phase).toBe('listening');
  });

  it('refuses a voice task while a typed turn is running', async () => {
    const { transport, hook, chat } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    const busyChat = { ...chat, sending: true, activeTurnId: 'typed_turn' };
    hook.rerender({ inputRequired: false, chat: busyChat });

    act(() => transport.receive(said('user', 'Uruchom testy.')));
    delegate(transport);
    hook.rerender({ inputRequired: false, chat: { ...busyChat, sending: false, activeTurnId: null } });

    expect(chat.send).not.toHaveBeenCalled();
    expect(speakableResults(transport, 'del_1')).toEqual([expect.stringMatching(/Not started/i)]);
  });

  it('never talks over GPT-Live: context waits until it has finished speaking', async () => {
    const { ipc, transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    act(() => transport.receive(said('user', 'Uruchom testy.')));
    delegate(transport);
    act(() => transport.receive(said('assistant', 'Jasne,')));

    act(() => {
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('agent_1', { type: 'user_prompt', source: 'user', text: 'Uruchom testy.' }),
      });
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('agent_1', {
          type: 'tool_call_requested',
          source: 'model',
          callId: 'call_1',
          name: 'bash',
          input: { command: 'pnpm test' },
        }),
      });
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('typed', { type: 'user_prompt', source: 'user', text: 'Dopisz też changelog.' }),
      });
    });
    finishAgentTurn(ipc, 'agent_1', 'Uruchom testy.', 'Testy przeszły.');

    expect(transport.sent).toEqual([]);

    act(() => transport.receive(said('assistant', ' przekazuję.')));
    await quiet();

    expect(transport.sent.map((message) => (message as { type?: string }).type)).toEqual([
      'session.thinking.append',
      'session.thinking.append',
      'session.commentary.append',
    ]);
    expect(speakableResults(transport, 'del_1')).toEqual(['The Moxxy agent finished. Its reply: Testy przeszły.']);
  });

  it('keeps GPT-Live and the rail informed about what the agent is doing', async () => {
    const { ipc, transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
    act(() => transport.receive(said('user', 'Uruchom testy.')));
    delegate(transport);

    act(() => {
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('agent_1', { type: 'user_prompt', source: 'user', text: 'Uruchom testy.' }),
      });
      ipc.emit('runner.event', {
        workspaceId: 'workspace-1',
        event: runnerEvent('agent_1', {
          type: 'tool_call_requested',
          source: 'model',
          callId: 'call_1',
          name: 'bash',
          input: { command: 'pnpm test' },
        }),
      });
    });

    expect(transport.sent).toContainEqual({
      type: 'session.thinking.append',
      delegation_id: null,
      content: expect.stringMatching(/^Progress of the running Moxxy task "Uruchom testy\." \(running for under a minute\): step 1, the agent is running checks or tests \(pnpm test\)\.$/),
    });
    expect(hook.result.current.activeOperations.map((operation) => operation.kind)).toEqual(['verification']);
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
    act(() => transport.receive(said('user', 'Halo, jesteś tam?')));

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
    const { transport, hook } = await openCall(true, 'Recording a voice conversation requires runner protocol v20');
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    act(() => transport.receive(said('user', 'Halo?')));
    act(() => transport.receive(said('assistant', 'Słucham.')));
    await quiet();

    await waitFor(() => expect(hook.result.current.phase).toBe('error'));
    expect(hook.result.current.errorReason).toMatch(/save.*chat.*protocol v20/i);
    expect(transport.closed).toBe(true);
  });

  it('surfaces a session the service ended', async () => {
    const { transport, hook } = await openCall();
    await waitFor(() => expect(hook.result.current.phase).toBe('listening'));

    act(() => transport.receive({ type: 'session.closed', event_id: 'evt_closed', reason: 'expired', session: {} }));

    expect(hook.result.current.phase).toBe('error');
    expect(hook.result.current.errorReason).toMatch(/expired/);
    expect(transport.closed).toBe(true);
  });
});

it('refreshes status for a typed task when the person starts asking about progress', async () => {
  const { ipc, transport, hook } = await openCall();
  await waitFor(() => expect(hook.result.current.phase).toBe('listening'));
  act(() => {
    ipc.emit('runner.event', { workspaceId: 'workspace-1', event: runnerEvent('typed', { type: 'user_prompt', text: 'Run the tests', source: 'user' }) });
    ipc.emit('runner.event', { workspaceId: 'workspace-1', event: runnerEvent('typed', { type: 'tool_call_requested', callId: 'c', name: 'Bash', input: { command: 'pnpm test' }, source: 'model' }) });
  });
  const before = transport.sent.length;
  act(() => transport.receive({ type: 'session.input_transcript.delta', delta: 'How is it going?' }));
  expect(JSON.stringify(transport.sent.slice(before))).toMatch(/pnpm test/);
});
