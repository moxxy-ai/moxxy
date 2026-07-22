import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { toErrorMessage } from './errors.js';
import { api } from './transport.js';
import {
  createVoiceCallState,
  reduceVoiceCall,
  type VoiceCallPhase,
} from './voice-call-machine.js';
import { useStreamingVoiceMode } from './useStreamingVoiceMode.js';
import { useVoiceRecorder } from './useVoiceRecorder.js';

export interface VoiceCallChat {
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly error: string | null;
  readonly send: (prompt: string) => Promise<void>;
}

export interface UseVoiceCallOptions {
  readonly workspaceId: string;
  readonly ready: boolean;
  readonly chat: VoiceCallChat;
  readonly inputRequired: boolean;
}

export interface UseVoiceCall {
  readonly active: boolean;
  readonly phase: VoiceCallPhase;
  readonly errorReason: string | null;
  readonly lastTranscript: string | null;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly open: () => void;
  readonly close: () => void;
  readonly retry: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  /** Stop the current utterance and hand it to the existing transcriber. */
  readonly finishUtterance: () => void;
  /** Discard a no-speech capture and immediately arm a fresh one. */
  readonly restartListening: () => void;
}

const LOCAL_PIPER = 'local-piper';

/** Coordinates one half-duplex call over the current chat session. */
export function useVoiceCall({
  workspaceId,
  ready,
  chat,
  inputRequired,
}: UseVoiceCallOptions): UseVoiceCall {
  const [state, dispatch] = useReducer(reduceVoiceCall, undefined, createVoiceCallState);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [inputAnalyser, setInputAnalyser] = useState<unknown | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<unknown | null>(null);
  const [turnRequestPending, setTurnRequestPending] = useState(false);
  const generationRef = useRef(0);
  const turnCycleRef = useRef(false);
  const turnObservedRef = useRef(false);
  const completionTargetRef = useRef<number | null>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const speech = useStreamingVoiceMode(workspaceId, {
    requireSynthesizer: true,
    onAnalyser: setOutputAnalyser,
  });
  const completedTurnCountRef = useRef(speech.completedTurnCount);
  completedTurnCountRef.current = speech.completedTurnCount;

  const onTranscript = useCallback((text: string): void => {
    // Set synchronously before React commits phase updates. Without this gate,
    // an immediately-resolving transcriber can briefly expose recorder=idle
    // while the machine still renders listening and accidentally open a second
    // microphone capture before transcript-ready commits.
    turnCycleRef.current = true;
    turnObservedRef.current = false;
    completionTargetRef.current = completedTurnCountRef.current + 1;
    setLastTranscript(text);
    dispatch({ type: 'transcript-ready' });
    setTurnRequestPending(true);
    void chatRef.current.send(text)
      .catch((error: unknown) => {
        dispatch({ type: 'failed', reason: toErrorMessage(error) });
      })
      .finally(() => setTurnRequestPending(false));
  }, []);

  const voice = useVoiceRecorder({
    workspaceId,
    onTranscript,
    onAnalyser: setInputAnalyser,
  });

  const releaseResources = useCallback((): void => {
    generationRef.current += 1;
    voice.cancel();
    speech.disable();
    setInputAnalyser(null);
    setOutputAnalyser(null);
    setTurnRequestPending(false);
    turnCycleRef.current = false;
    turnObservedRef.current = false;
    completionTargetRef.current = null;
  }, [speech.disable, voice.cancel]);

  const preflight = useCallback(async (generation: number): Promise<void> => {
    if (!ready) {
      dispatch({ type: 'failed', reason: 'This session is still connecting.' });
      return;
    }
    try {
      const [hasTranscriber, info] = await Promise.all([
        api().invoke('session.hasTranscriber'),
        api().invoke('session.info', { workspaceId }),
      ]);
      if (generation !== generationRef.current) return;
      if (!hasTranscriber) {
        dispatch({ type: 'failed', reason: 'Voice transcription is unavailable.' });
        return;
      }
      if (!info || info.activeSynthesizer !== LOCAL_PIPER) {
        dispatch({
          type: 'failed',
          reason: 'Local Piper is not active. Select local-piper as the synthesizer and try again.',
        });
        return;
      }
      speech.enable();
      const currentChat = chatRef.current;
      if (currentChat.sending || currentChat.activeTurnId !== null) {
        turnCycleRef.current = true;
        turnObservedRef.current = true;
        completionTargetRef.current = completedTurnCountRef.current + 1;
        dispatch({ type: 'turn-started' });
      } else {
        turnCycleRef.current = false;
        completionTargetRef.current = null;
        dispatch({ type: 'ready' });
      }
    } catch (error) {
      if (generation !== generationRef.current) return;
      dispatch({ type: 'failed', reason: toErrorMessage(error) });
    }
  }, [ready, speech.enable, workspaceId]);

  const begin = useCallback((kind: 'open' | 'retry'): void => {
    releaseResources();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    dispatch({ type: kind });
    void preflight(generation);
  }, [preflight, releaseResources]);

  const open = useCallback((): void => begin('open'), [begin]);
  const retry = useCallback((): void => begin('retry'), [begin]);
  const close = useCallback((): void => {
    releaseResources();
    setLastTranscript(null);
    dispatch({ type: 'close' });
  }, [releaseResources]);

  const pause = useCallback((): void => {
    if (state.phase !== 'listening') return;
    voice.cancel();
    setInputAnalyser(null);
    dispatch({ type: 'pause' });
  }, [state.phase, voice.cancel]);

  const resume = useCallback((): void => dispatch({ type: 'resume' }), []);
  const finishUtterance = useCallback((): void => voice.stop(), [voice.stop]);
  const restartListening = useCallback((): void => {
    if (state.phase !== 'listening') return;
    voice.cancel();
  }, [state.phase, voice.cancel]);

  // Listening owns the microphone. Every other state keeps it released, which
  // makes self-transcription of Piper structurally impossible.
  useEffect(() => {
    if (
      !state.active ||
      state.phase !== 'listening' ||
      voice.phase !== 'idle' ||
      turnCycleRef.current
    ) return;
    voice.start();
  }, [state.active, state.phase, voice.phase, voice.start]);

  useEffect(() => {
    if (!state.active) return;
    if (voice.phase === 'transcribing') {
      dispatch({ type: 'transcribing' });
    } else if (voice.phase === 'error' && voice.errorReason) {
      dispatch({ type: 'failed', reason: voice.errorReason });
    }
  }, [state.active, voice.errorReason, voice.phase]);

  useEffect(() => {
    if (!state.active) return;
    if (speech.phase === 'synthesizing') {
      dispatch({ type: 'synthesizing' });
    } else if (speech.phase === 'speaking') {
      dispatch({ type: 'speaking' });
    } else if (speech.phase === 'error') {
      dispatch({
        type: 'failed',
        reason: speech.errorReason ?? 'Piper could not play this response.',
      });
    }
  }, [speech.errorReason, speech.phase, state.active]);

  useEffect(() => {
    if (!state.active) return;
    if (inputRequired && state.phase !== 'waiting-for-input') {
      voice.cancel();
      dispatch({ type: 'input-required' });
    } else if (!inputRequired && state.phase === 'waiting-for-input') {
      dispatch({ type: 'input-resolved' });
    }
  }, [inputRequired, state.active, state.phase, voice.cancel]);

  useEffect(() => {
    if (!state.active) return;
    if (chat.sending || chat.activeTurnId !== null) {
      turnObservedRef.current = true;
    }
  }, [chat.activeTurnId, chat.sending, state.active]);

  useEffect(() => {
    if (!state.active) return;
    const turnBusy = turnRequestPending || chat.sending || chat.activeTurnId !== null;
    const waitingForTurn =
      state.phase === 'thinking' ||
      state.phase === 'synthesizing' ||
      state.phase === 'speaking';
    if (
      waitingForTurn &&
      turnObservedRef.current &&
      completionTargetRef.current !== null &&
      speech.completedTurnCount >= completionTargetRef.current &&
      !turnBusy &&
      !inputRequired &&
      speech.phase === 'idle' &&
      voice.phase === 'idle'
    ) {
      const turnError = speech.completedTurnError ?? chat.error;
      if (turnError) {
        dispatch({ type: 'failed', reason: turnError });
      } else {
        turnCycleRef.current = false;
        turnObservedRef.current = false;
        completionTargetRef.current = null;
        dispatch({ type: 'turn-settled' });
      }
    }
  }, [
    chat.activeTurnId,
    chat.error,
    chat.sending,
    inputRequired,
    speech.phase,
    speech.completedTurnCount,
    speech.completedTurnError,
    state.active,
    state.phase,
    turnRequestPending,
    voice.phase,
  ]);

  useEffect(() => {
    if (!state.active || ready || state.phase === 'error') return;
    releaseResources();
    dispatch({
      type: 'failed',
      reason: 'The session connection was lost. Reconnect and try again.',
    });
  }, [ready, releaseResources, state.active, state.phase]);

  const previousWorkspaceRef = useRef(workspaceId);
  useEffect(() => {
    if (previousWorkspaceRef.current !== workspaceId && state.active) close();
    previousWorkspaceRef.current = workspaceId;
  }, [close, state.active, workspaceId]);

  useEffect(() => () => {
    generationRef.current += 1;
  }, []);

  return {
    active: state.active,
    phase: state.phase,
    errorReason: state.errorReason,
    lastTranscript,
    inputAnalyser,
    outputAnalyser,
    open,
    close,
    retry,
    pause,
    resume,
    finishUtterance,
    restartListening,
  };
}
