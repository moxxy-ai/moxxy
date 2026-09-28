import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  toErrorMessage,
  type UseVoiceCall,
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
const NO_OPERATIONS = Object.freeze([]);
const APPROVAL_CONTEXT =
  'The Moxxy agent is paused, waiting for the user to approve a step in the Moxxy window. If the user asks about the task, tell them to check that approval on screen.';

/** Where the call rests between spoken turns. */
function restingPhase(muted: boolean, tasksInFlight: number, inputRequired: boolean): VoiceCallPhase {
  if (tasksInFlight > 0) return inputRequired ? 'waiting-for-input' : 'working';
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
  const generationRef = useRef(0);
  const connectionRef = useRef<GptLiveConnection | null>(null);
  const exchangeRef = useRef<GptLiveExchangeState>(EMPTY_GPT_LIVE_EXCHANGE);
  const mirrorRef = useRef(new GptLiveChatMirror());
  const delegationsRef = useRef(new GptLiveDelegations());
  const mutedRef = useRef(false);
  const failRef = useRef<(message: string) => void>(NOOP);
  const chatRef = useRef(chat);
  const inputRequiredRef = useRef(inputRequired);
  chatRef.current = chat;
  inputRequiredRef.current = inputRequired;

  const rest = useCallback((): VoiceCallPhase => restingPhase(
    mutedRef.current,
    delegationsRef.current.inFlight,
    inputRequiredRef.current,
  ), []);

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
    for (const message of buildGptLiveDelegationResult(result.itemId, result.text)) {
      connectionRef.current?.send(message);
    }
    setState((current) => ({ ...current, phase: rest() }));
  }, [rest]);

  const dispatch = useCallback((itemId: string, prompt: string): void => {
    delegationsRef.current.dispatched(itemId, prompt);
    // The agent's own user_prompt / reply for this turn reach GPT-Live as the
    // delegation result, not a second time as chat context.
    mirrorRef.current.expectRecorded({ userText: prompt });
    setState((current) => ({ ...current, phase: rest() }));
    const delegations = delegationsRef.current;
    void chatRef.current.send(prompt).catch((error: unknown) => {
      if (delegations === delegationsRef.current) {
        deliver(delegations.failDispatch(itemId, toErrorMessage(error)));
      }
    });
  }, [deliver, rest]);

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
      dispatch(itemId, claimed.text);
      return;
    }
    // Usually the delegation lands before the user's turn is final.
    delegationsRef.current.waitForUserTurn(itemId, userTurnId);
  }, [dispatch]);

  const handleEvent = useCallback((event: GptLiveEvent): void => {
    switch (event.type) {
      case 'turn-started':
        if (event.role === 'assistant') setState((current) => ({ ...current, phase: 'speaking' }));
        return;
      case 'turn-done': {
        if (event.role === 'user') {
          setLastTranscript(event.text);
          const itemId = event.text ? delegationsRef.current.takeWaitingFor(event.turnId) : null;
          if (itemId) {
            dispatch(itemId, event.text);
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
  }, [dispatch, fail, handleDelegation, record, rest]);

  const open = useCallback((): void => {
    release();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    mirrorRef.current = new GptLiveChatMirror();
    delegationsRef.current = new GptLiveDelegations();
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
      delegationsRef.current.observe(event);
      const context = mirrorRef.current.contextFor(event);
      if (!context) return;
      for (const message of buildGptLiveDeveloperContext(context)) connectionRef.current?.send(message);
    });
    const offComplete = api().subscribe('runner.turn.complete', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      deliver(delegationsRef.current.complete(payload.turnId, payload.error ?? null));
    });
    return () => {
      offEvent();
      offComplete();
    };
  }, [deliver, state.active, workspaceId]);

  useEffect(() => {
    if (!state.active || state.phase === 'error' || delegationsRef.current.inFlight === 0) return;
    if (inputRequired) {
      for (const message of buildGptLiveDeveloperContext(APPROVAL_CONTEXT)) connectionRef.current?.send(message);
    }
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
    activeOperations: NO_OPERATIONS,
    errorReason: state.errorReason,
    microphoneMuted: state.microphoneMuted,
    waitingSoundEnabled: false,
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
    toggleWaitingSound: NOOP,
    // GPT-Live detects turn ends and interruptions on the server.
    finishUtterance: NOOP,
    restartListening: NOOP,
    bargeIn: NOOP,
  };
}
