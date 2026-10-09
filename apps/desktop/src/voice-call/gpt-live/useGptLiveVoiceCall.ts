import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  toErrorMessage,
  useQueuedTurns,
  type UseVoiceCall,
  type VoiceActiveOperation,
  type VoiceCallChat,
  type VoiceCallPhase,
} from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { GptLiveChatMirror } from './gpt-live-chat-context';
import { GptLiveDelegations, type GptLiveDelegationResult } from './gpt-live-delegation';
import {
  EMPTY_GPT_LIVE_EXCHANGE,
  acceptGptLiveTurn,
  claimGptLiveUserTurn,
  flushGptLiveExchange,
  type GptLiveExchange,
  type GptLiveExchangeState,
} from './gpt-live-exchange';
import { GptLiveOutbox } from './gpt-live-outbox';
import {
  GPT_LIVE_SESSION_CLOSE,
  buildGptLiveDelegationResult,
  buildGptLiveDeveloperContext,
  parseGptLiveEvent,
  type GptLiveEvent,
} from './gpt-live-protocol';
import {
  BrowserGptLiveTransport,
  type GptLiveConnection,
  type GptLiveTransport,
} from './gpt-live-transport';

export interface UseGptLiveVoiceCallOptions {
  readonly workspaceId: string;
  readonly ready: boolean;
  /** Runs a delegated task as an ordinary agent turn in this chat. */
  readonly chat: VoiceCallChat;
  /** True while the agent waits for the user to answer a prompt on screen. */
  readonly inputRequired: boolean;
  readonly transport?: GptLiveTransport;
}

interface TaskState {
  readonly inFlight: number;
  readonly operations: ReadonlyArray<VoiceActiveOperation>;
}

const NO_TASKS: TaskState = Object.freeze({ inFlight: 0, operations: [] });

interface CallState {
  readonly active: boolean;
  readonly phase: VoiceCallPhase;
  readonly errorReason: string | null;
  readonly microphoneMuted: boolean;
}

const IDLE: CallState = Object.freeze({
  active: false,
  phase: 'idle',
  errorReason: null,
  microphoneMuted: false,
});
const NOOP = (): void => undefined;
const APPROVAL_CONTEXT =
  'The Moxxy agent is paused, waiting for the user to approve a step in the Moxxy window. If the user asks about the task, tell them to check that approval on screen.';

/** Where the call rests between spoken turns. */
function restingPhase(muted: boolean, tasks: number, inputRequired: boolean): VoiceCallPhase {
  if (tasks > 0) return inputRequired ? 'waiting-for-input' : 'working';
  return muted ? 'paused' : 'listening';
}

/**
 * Voice Mode over a full-duplex GPT-Live call.
 *
 * GPT-Live holds the conversation itself, knowing the chat. When the user
 * explicitly asks for something to be done, GPT-Live delegates: the user's own
 * transcribed words run as an ordinary agent turn in this chat, and only that
 * turn's real final reply is handed back for GPT-Live to read out. Talk it
 * answers itself is recorded into the chat as it happens.
 *
 * Voice never feeds the chat queue: one task runs at a time, and a task asked
 * for while the agent is busy is refused so the agent finishes what it is
 * doing. Only typed messages queue. Nothing is sent to GPT-Live while it
 * speaks — an append would cut its answer off.
 */
export function useGptLiveVoiceCall({
  workspaceId,
  ready,
  chat,
  inputRequired,
  transport: transportOverride,
}: UseGptLiveVoiceCallOptions): UseVoiceCall {
  const transport = useMemo(
    () => transportOverride ?? new BrowserGptLiveTransport(),
    [transportOverride],
  );
  const [state, setState] = useState<CallState>(IDLE);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [inputAnalyser, setInputAnalyser] = useState<unknown | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<unknown | null>(null);
  const [tasks, setTasks] = useState<TaskState>(NO_TASKS);
  const queuedTurns = useQueuedTurns(workspaceId);
  const chatBusy = chat.sending || chat.activeTurnId !== null || queuedTurns.length > 0;
  const generationRef = useRef(0);
  const connectionRef = useRef<GptLiveConnection | null>(null);
  const exchangeRef = useRef<GptLiveExchangeState>(EMPTY_GPT_LIVE_EXCHANGE);
  const mirrorRef = useRef(new GptLiveChatMirror());
  const delegationsRef = useRef(new GptLiveDelegations());
  const outboxRef = useRef(new GptLiveOutbox());
  const mutedRef = useRef(false);
  const failRef = useRef<(message: string) => void>(NOOP);
  const chatRef = useRef(chat);
  const inputRequiredRef = useRef(inputRequired);
  const chatBusyRef = useRef(chatBusy);
  chatRef.current = chat;
  inputRequiredRef.current = inputRequired;
  chatBusyRef.current = chatBusy;

  const rest = useCallback((): VoiceCallPhase => {
    return restingPhase(mutedRef.current, delegationsRef.current.inFlight, inputRequiredRef.current);
  }, []);

  const syncTasks = useCallback((): void => {
    const delegations = delegationsRef.current;
    setTasks({
      inFlight: delegations.inFlight,
      operations: delegations.activeOperations,
    });
  }, []);

  const transmit = useCallback((messages: ReadonlyArray<unknown>): void => {
    for (const message of messages) connectionRef.current?.send(message);
  }, []);

  const send = useCallback((messages: ReadonlyArray<unknown>): void => {
    transmit(outboxRef.current.offer(messages));
  }, [transmit]);

  /** A conversation the chat cannot keep must stop the call, not vanish. The
   *  final flush on close has no call left to stop, so it is best-effort. */
  const record = useCallback((exchange: GptLiveExchange | null, stopOnFailure: boolean): void => {
    if (!exchange) return;
    mirrorRef.current.expectRecorded(exchange);
    const generation = generationRef.current;
    void api()
      .invoke('session.recordVoiceExchange', { workspaceId, ...exchange })
      .catch((error: unknown) => {
        if (stopOnFailure && generation === generationRef.current) {
          failRef.current(`Couldn't save the voice conversation to the chat: ${toErrorMessage(error)}`);
        }
      });
  }, [workspaceId]);

  const deliver = useCallback((result: GptLiveDelegationResult | null): void => {
    if (!result) return;
    send(buildGptLiveDelegationResult(result.itemId, result.text));
    syncTasks();
    setState((current) => ({ ...current, phase: rest() }));
  }, [rest, send, syncTasks]);

  const dispatch = useCallback((itemId: string, prompt: string): void => {
    delegationsRef.current.dispatched(itemId, prompt);
    // The agent's own user_prompt / reply for this turn reach GPT-Live as the
    // delegation result, not a second time as chat context.
    mirrorRef.current.expectRecorded({ userText: prompt });
    syncTasks();
    setState((current) => ({ ...current, phase: rest() }));
    const delegations = delegationsRef.current;
    void chatRef.current.send(prompt).catch((error: unknown) => {
      if (delegations === delegationsRef.current) {
        deliver(delegations.failDispatch(itemId, toErrorMessage(error)));
      }
    });
  }, [deliver, rest, syncTasks]);

  /** One task at a time: the agent finishes what it is doing before another starts. */
  const requestTask = useCallback((itemId: string, prompt: string): void => {
    const delegations = delegationsRef.current;
    if (delegations.inFlight === 0 && !chatBusyRef.current) {
      dispatch(itemId, prompt);
      return;
    }
    deliver(delegations.refuseWhileBusy(itemId));
    record({ userText: prompt, assistantText: 'Not started: the Moxxy agent was still working on another task.' }, true);
  }, [deliver, dispatch, record]);

  const release = useCallback((): void => {
    generationRef.current += 1;
    const connection = connectionRef.current;
    connectionRef.current = null;
    if (connection) {
      connection.send(GPT_LIVE_SESSION_CLOSE);
      connection.close();
    }
    record(flushGptLiveExchange(exchangeRef.current), false);
    exchangeRef.current = EMPTY_GPT_LIVE_EXCHANGE;
    setTasks(NO_TASKS);
    setInputAnalyser(null);
    setOutputAnalyser(null);
  }, [record]);

  const fail = useCallback((message: string): void => {
    release();
    setState((current) => ({ ...current, active: true, phase: 'error', errorReason: message.slice(0, 500) }));
  }, [release]);
  failRef.current = fail;

  const handleDelegation = useCallback((itemId: string, userTurnId: string | null): void => {
    const turnId = userTurnId ?? exchangeRef.current.pendingUserTurns.at(-1)?.turnId ?? null;
    const claimed = turnId ? claimGptLiveUserTurn(exchangeRef.current, turnId) : null;
    if (claimed?.text) {
      exchangeRef.current = claimed.state;
      requestTask(itemId, claimed.text);
      return;
    }
    // Usually the delegation lands before the user's turn is final.
    delegationsRef.current.waitForUserTurn(itemId, userTurnId);
  }, [requestTask]);

  const handleEvent = useCallback((event: GptLiveEvent): void => {
    switch (event.type) {
      case 'turn-started':
        if (event.role !== 'assistant') return;
        outboxRef.current.speakingStarted();
        setState((current) => ({ ...current, phase: 'speaking' }));
        return;
      case 'turn-done': {
        if (event.role === 'assistant') transmit(outboxRef.current.speakingFinished());
        if (event.role === 'user') {
          setLastTranscript(event.text);
          const itemId = event.text ? delegationsRef.current.takeWaitingFor(event.turnId) : null;
          if (itemId) {
            requestTask(itemId, event.text);
            return;
          }
        }
        const step = acceptGptLiveTurn(exchangeRef.current, event);
        exchangeRef.current = step.state;
        record(step.exchange, true);
        setState((current) => ({
          ...current,
          phase: event.role === 'assistant'
            ? rest()
            : current.phase === 'speaking' ? 'speaking' : 'thinking',
        }));
        return;
      }
      case 'delegation':
        handleDelegation(event.itemId, event.userTurnId);
        return;
      case 'session-closed':
        if (event.reason !== 'client_request') fail(`GPT-Live ended the call (${event.reason}).`);
        return;
      case 'error':
        fail(event.message);
        return;
      default:
    }
  }, [fail, handleDelegation, record, requestTask, rest, transmit]);

  const open = useCallback((): void => {
    release();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    mirrorRef.current = new GptLiveChatMirror();
    delegationsRef.current = new GptLiveDelegations();
    outboxRef.current = new GptLiveOutbox();
    mutedRef.current = false;
    setLastTranscript(null);
    setState({ active: true, phase: 'checking', errorReason: null, microphoneMuted: false });
    if (!ready) {
      fail('This session is still connecting.');
      return;
    }
    void (async () => {
      const { authenticated } = await api().invoke('voice.live.preflight');
      if (generation !== generationRef.current) return;
      if (!authenticated) {
        fail('Sign in with ChatGPT in Settings → Providers to use GPT-Live.');
        return;
      }
      setState((current) => ({ ...current, phase: 'arming' }));
      const connection = await transport.connect({
        negotiate: (sdp) => api().invoke('voice.live.start', { workspaceId, sdp }),
        onEvent: (raw) => {
          const event = parseGptLiveEvent(raw);
          if (event && generation === generationRef.current) handleEvent(event);
        },
        onInputAnalyser: setInputAnalyser,
        onOutputAnalyser: setOutputAnalyser,
        onConnectionError: (message) => {
          if (generation === generationRef.current) fail(message);
        },
      });
      if (generation !== generationRef.current) {
        connection.close();
        return;
      }
      connectionRef.current = connection;
      setState((current) => ({ ...current, phase: rest() }));
    })().catch((error: unknown) => {
      if (generation === generationRef.current) fail(toErrorMessage(error));
    });
  }, [fail, handleEvent, ready, release, rest, transport, workspaceId]);

  const close = useCallback((): void => {
    release();
    setState(IDLE);
  }, [release]);

  const setMicrophoneMuted = useCallback((muted: boolean): void => {
    if (!state.active || state.phase === 'error') return;
    mutedRef.current = muted;
    connectionRef.current?.setMuted(muted);
    setState((current) => ({
      ...current,
      microphoneMuted: muted,
      phase: current.phase === 'speaking' ? 'speaking' : rest(),
    }));
  }, [rest, state.active, state.phase]);

  useEffect(() => {
    if (!state.active) return;
    const offEvent = api().subscribe('runner.event', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      const event = payload.event as MoxxyEvent;
      const progress = delegationsRef.current.observe(event);
      if (progress) send(buildGptLiveDeveloperContext(progress));
      if (event.type === 'tool_call_requested' || event.type === 'tool_result') syncTasks();
      const context = mirrorRef.current.contextFor(event);
      if (context) send(buildGptLiveDeveloperContext(context));
    });
    const offComplete = api().subscribe('runner.turn.complete', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      deliver(delegationsRef.current.complete(payload.turnId, payload.error ?? null));
    });
    return () => {
      offEvent();
      offComplete();
    };
  }, [deliver, send, state.active, syncTasks, workspaceId]);

  useEffect(() => {
    if (!state.active || state.phase === 'error' || delegationsRef.current.inFlight === 0) return;
    if (inputRequired) send(buildGptLiveDeveloperContext(APPROVAL_CONTEXT));
    setState((current) => (current.phase === 'speaking' ? current : { ...current, phase: rest() }));
    // Re-run only when an approval starts or ends, not on every phase change.
  }, [inputRequired]);

  useEffect(() => {
    if (state.active && !ready && state.phase !== 'error') {
      fail('The session connection was lost. Reconnect and try again.');
    }
  }, [fail, ready, state.active, state.phase]);

  const workspaceRef = useRef(workspaceId);
  useEffect(() => {
    if (workspaceRef.current !== workspaceId) close();
    workspaceRef.current = workspaceId;
  }, [close, workspaceId]);

  useEffect(() => release, [release]);

  return {
    active: state.active,
    phase: state.phase,
    activity: null,
    activeOperations: tasks.operations,
    errorReason: state.errorReason,
    microphoneMuted: state.microphoneMuted,
    localPiperInstallRequired: false,
    localPiperInstalling: false,
    localPiperInstallError: null,
    lastTranscript,
    inputAnalyser,
    outputAnalyser,
    open,
    close,
    retry: open,
    installLocalPiper: NOOP,
    muteMicrophone: () => setMicrophoneMuted(true),
    unmuteMicrophone: () => setMicrophoneMuted(false),
    // GPT-Live detects turn ends and interruptions on the server.
    finishUtterance: NOOP,
    restartListening: NOOP,
    bargeIn: NOOP,
  };
}
