import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { toErrorMessage } from './errors.js';
import { getPlatform, type AudioClipHandle } from './platform.js';
import { api } from './transport.js';
import {
  createVoiceCallState,
  reduceVoiceCall,
  type VoiceCallPhase,
} from './voice-call-machine.js';
import { useStreamingVoiceMode } from './useStreamingVoiceMode.js';
import {
  VoiceFeedbackScheduler,
  categorizeVoiceToolActivity,
  type VoiceToolActivity,
} from './voice-feedback-scheduler.js';
import { useVoiceRecorder } from './useVoiceRecorder.js';

export interface VoiceWaitingToneSource {
  readonly audioUrl: string;
}

export interface VoiceCallChat {
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly error: string | null;
  readonly send: (prompt: string) => Promise<void>;
  readonly abort: () => Promise<void>;
}

export interface UseVoiceCallOptions {
  readonly workspaceId: string;
  readonly ready: boolean;
  readonly chat: VoiceCallChat;
  readonly inputRequired: boolean;
  readonly waitingTone?: VoiceWaitingToneSource;
}

export interface UseVoiceCall {
  readonly active: boolean;
  readonly phase: VoiceCallPhase;
  readonly activity: VoiceToolActivity | null;
  readonly errorReason: string | null;
  readonly microphoneMuted: boolean;
  readonly waitingSoundEnabled: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
  readonly lastTranscript: string | null;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly open: () => void;
  readonly close: () => void;
  readonly retry: () => void;
  readonly installLocalPiper: () => void;
  readonly muteMicrophone: () => void;
  readonly unmuteMicrophone: () => void;
  readonly toggleWaitingSound: () => void;
  /** Stop the current utterance and hand it to the existing transcriber. */
  readonly finishUtterance: () => void;
  /** Discard a no-speech capture and immediately arm a fresh one. */
  readonly restartListening: () => void;
  /** Interrupt current spoken output while preserving the live user capture. */
  readonly bargeIn: () => void;
}

const LOCAL_PIPER = 'local-piper';
const WAITING_SOUND_PREFERENCE = 'moxxy.voice.waiting-sound';
const POST_INSTALL_PREFLIGHT_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 1_500, 2_000, 2_500] as const;

interface VoicePreflightStatus {
  readonly hasTranscriber: boolean;
  readonly activeSynthesizer: string | null;
}

async function readVoicePreflightStatus(workspaceId: string): Promise<VoicePreflightStatus> {
  const [hasTranscriber, info] = await Promise.all([
    api().invoke('session.hasTranscriber'),
    api().invoke('session.info', { workspaceId }),
  ]);
  return {
    hasTranscriber,
    activeSynthesizer: info ? info.activeSynthesizer : null,
  };
}

function waitForPreflightRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function readWaitingSoundPreference(): boolean {
  return getPlatform().kv?.getItem(WAITING_SOUND_PREFERENCE) !== '0';
}

/** Coordinates one half-duplex call over the current chat session. */
export function useVoiceCall({
  workspaceId,
  ready,
  chat,
  inputRequired,
  waitingTone,
}: UseVoiceCallOptions): UseVoiceCall {
  const [state, dispatch] = useReducer(reduceVoiceCall, undefined, createVoiceCallState);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [inputAnalyser, setInputAnalyser] = useState<unknown | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<unknown | null>(null);
  const [activity, setActivity] = useState<VoiceToolActivity | null>(null);
  const [waitingSoundEnabled, setWaitingSoundEnabled] = useState(readWaitingSoundPreference);
  const [localPiperInstallRequired, setLocalPiperInstallRequired] = useState(false);
  const [localPiperInstalling, setLocalPiperInstalling] = useState(false);
  const [turnRequestPending, setTurnRequestPending] = useState(false);
  const generationRef = useRef(0);
  const turnCycleRef = useRef(false);
  const turnObservedRef = useRef(false);
  const completionTargetRef = useRef<number | null>(null);
  const currentTurnIdRef = useRef<string | null>(null);
  const activeToolActivitiesRef = useRef(new Map<string, VoiceToolActivity>());
  const toolNamesByCallRef = useRef(new Map<string, string>());
  const feedbackTurnActiveRef = useRef(false);
  const waitingToneHandleRef = useRef<AudioClipHandle | null>(null);
  const waitingToneGenerationRef = useRef(0);
  const previousInputRequiredRef = useRef(false);
  const interruptedTurnIdsRef = useRef(new Set<string>());
  const bargeInTransitionRef = useRef(false);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const feedbackRef = useRef<VoiceFeedbackScheduler | null>(null);
  const speech = useStreamingVoiceMode(workspaceId, {
    requireSynthesizer: true,
    onAnalyser: setOutputAnalyser,
    onAssistantSpeechQueued: () => feedbackRef.current?.assistantSpeechQueued(),
  });
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const stopWaitingTone = useCallback((): void => {
    waitingToneGenerationRef.current += 1;
    waitingToneHandleRef.current?.stop();
    waitingToneHandleRef.current = null;
  }, []);
  const startWaitingTone = useCallback((): void => {
    stopWaitingTone();
    if (!waitingTone) return;
    const player = getPlatform().tts;
    if (!player?.playUrl) return;
    const generation = waitingToneGenerationRef.current;
    const clear = (): void => {
      if (waitingToneGenerationRef.current === generation) waitingToneHandleRef.current = null;
    };
    try {
      waitingToneHandleRef.current = player.playUrl(waitingTone.audioUrl, {
        loop: true,
        onend: clear,
        onerror: clear,
      });
    } catch {
      clear();
    }
  }, [stopWaitingTone, waitingTone]);
  const feedback = useMemo(
    () => new VoiceFeedbackScheduler({
      emitCue: (cue) => speechRef.current.speakCue(cue.text, cue.language),
      startWaitingTone,
      stopWaitingTone,
      cancelPendingCues: () => speechRef.current.cancelPendingCues(),
    }),
    [startWaitingTone, stopWaitingTone, workspaceId],
  );
  feedbackRef.current = feedback;
  useEffect(() => {
    feedback.setWaitingToneEnabled(waitingSoundEnabled);
  }, [feedback, waitingSoundEnabled]);
  const completedTurnCountRef = useRef(speech.completedTurnCount);
  completedTurnCountRef.current = speech.completedTurnCount;
  const previousSpeechPhaseRef = useRef(speech.phase);

  const onTranscript = useCallback((text: string): void => {
    // Set synchronously before React commits phase updates. Without this gate,
    // an immediately-resolving transcriber can briefly expose recorder=idle
    // while the machine still renders listening and accidentally open a second
    // microphone capture before transcript-ready commits.
    turnCycleRef.current = true;
    turnObservedRef.current = false;
    completionTargetRef.current = completedTurnCountRef.current + 1;
    currentTurnIdRef.current = null;
    activeToolActivitiesRef.current.clear();
    setActivity(null);
    feedback.attachTranscript(text);
    feedbackTurnActiveRef.current = true;
    setLastTranscript(text);
    dispatch({ type: 'transcript-ready' });
    setTurnRequestPending(true);
    void chatRef.current.send(text)
      .catch((error: unknown) => {
        feedback.endTurn();
        feedbackTurnActiveRef.current = false;
        dispatch({ type: 'failed', reason: toErrorMessage(error) });
      })
      .finally(() => setTurnRequestPending(false));
  }, [feedback]);

  const voice = useVoiceRecorder({
    workspaceId,
    onTranscript,
    onAnalyser: setInputAnalyser,
  });

  const releaseResources = useCallback((): void => {
    generationRef.current += 1;
    voice.cancel();
    speech.disable();
    feedback.close();
    setInputAnalyser(null);
    setOutputAnalyser(null);
    setTurnRequestPending(false);
    turnCycleRef.current = false;
    turnObservedRef.current = false;
    completionTargetRef.current = null;
    currentTurnIdRef.current = null;
    activeToolActivitiesRef.current.clear();
    setActivity(null);
    toolNamesByCallRef.current.clear();
    feedbackTurnActiveRef.current = false;
    previousInputRequiredRef.current = false;
    previousSpeechPhaseRef.current = 'idle';
    interruptedTurnIdsRef.current.clear();
    bargeInTransitionRef.current = false;
    setLocalPiperInstallRequired(false);
    setLocalPiperInstalling(false);
  }, [feedback, speech.disable, voice.cancel]);

  const preflight = useCallback(async (
    generation: number,
    retryRunnerRestart: boolean,
  ): Promise<void> => {
    if (!ready) {
      dispatch({ type: 'failed', reason: 'This session is still connecting.' });
      return;
    }
    try {
      let status = await readVoicePreflightStatus(workspaceId);
      if (retryRunnerRestart) {
        for (const delayMs of POST_INSTALL_PREFLIGHT_RETRY_DELAYS_MS) {
          if (status.hasTranscriber && status.activeSynthesizer === LOCAL_PIPER) break;
          await waitForPreflightRetry(delayMs);
          if (generation !== generationRef.current) return;
          status = await readVoicePreflightStatus(workspaceId);
        }
      }
      if (generation !== generationRef.current) return;
      if (!status.hasTranscriber) {
        dispatch({ type: 'failed', reason: 'Voice transcription is unavailable.' });
        return;
      }
      if (status.activeSynthesizer !== LOCAL_PIPER) {
        const installed = await api().invoke('voice.isLocalPiperInstalled');
        if (generation !== generationRef.current) return;
        setLocalPiperInstallRequired(!installed);
        dispatch({
          type: 'failed',
          reason: installed
            ? 'Local Piper is not active. Select local-piper as the synthesizer and try again.'
            : 'Local Piper is not installed.',
        });
        return;
      }
      setLocalPiperInstallRequired(false);
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

  const begin = useCallback((kind: 'open' | 'retry', retryRunnerRestart = false): void => {
    releaseResources();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    dispatch({ type: kind });
    void preflight(generation, retryRunnerRestart);
  }, [preflight, releaseResources]);

  const open = useCallback((): void => begin('open'), [begin]);
  const retry = useCallback((): void => begin('retry'), [begin]);
  const installLocalPiper = useCallback((): void => {
    if (!state.active || !localPiperInstallRequired || localPiperInstalling) return;
    const generation = generationRef.current;
    setLocalPiperInstalling(true);
    void api().invoke('voice.installLocalPiper')
      .then(() => {
        if (generation !== generationRef.current) return;
        setLocalPiperInstalling(false);
        begin('retry', true);
      })
      .catch((error: unknown) => {
        if (generation !== generationRef.current) return;
        setLocalPiperInstalling(false);
        setLocalPiperInstallRequired(true);
        dispatch({
          type: 'failed',
          reason: `Local Piper installation failed: ${toErrorMessage(error)}`,
        });
      });
  }, [begin, localPiperInstallRequired, localPiperInstalling, state.active]);
  const close = useCallback((): void => {
    releaseResources();
    setLastTranscript(null);
    dispatch({ type: 'close' });
  }, [releaseResources]);

  const muteMicrophone = useCallback((): void => {
    if (!state.active || state.phase === 'error') return;
    if (voice.phase === 'recording') {
      voice.cancel();
      setInputAnalyser(null);
    }
    dispatch({ type: 'mute-microphone' });
  }, [state.active, state.phase, voice.cancel, voice.phase]);

  const unmuteMicrophone = useCallback((): void => {
    if (!state.active || state.phase === 'error') return;
    dispatch({ type: 'unmute-microphone' });
  }, [state.active, state.phase]);
  const toggleWaitingSound = useCallback((): void => {
    setWaitingSoundEnabled((enabled) => {
      const next = !enabled;
      getPlatform().kv?.setItem(WAITING_SOUND_PREFERENCE, next ? '1' : '0');
      feedback.setWaitingToneEnabled(next);
      return next;
    });
  }, [feedback]);
  const finishUtterance = useCallback((): void => voice.stop(), [voice.stop]);
  const restartListening = useCallback((): void => {
    if (
      state.phase !== 'listening'
      && state.phase !== 'synthesizing'
      && state.phase !== 'speaking'
    ) return;
    voice.cancel();
  }, [state.phase, voice.cancel]);

  const bargeIn = useCallback((): void => {
    if (
      !state.active
      || state.microphoneMuted
      || (state.phase !== 'synthesizing' && state.phase !== 'speaking')
      || voice.phase !== 'recording'
    ) return;

    voice.markUtteranceStart();
    bargeInTransitionRef.current = true;
    const streamedTurnId = speechRef.current.interruptCurrentTurn();
    const interruptedTurnId = streamedTurnId
      ?? currentTurnIdRef.current
      ?? chatRef.current.activeTurnId;
    if (interruptedTurnId !== null) interruptedTurnIdsRef.current.add(interruptedTurnId);
    feedback.endTurn();
    feedbackTurnActiveRef.current = false;
    turnCycleRef.current = false;
    turnObservedRef.current = false;
    completionTargetRef.current = null;
    currentTurnIdRef.current = null;
    activeToolActivitiesRef.current.clear();
    toolNamesByCallRef.current.clear();
    setActivity(null);
    dispatch({ type: 'barge-in' });
    void chatRef.current.abort();
  }, [feedback, state.active, state.microphoneMuted, state.phase, voice]);

  // Normal listening and interruptible Piper playback share one capture. The
  // platform's AEC removes render echo; barge-in marks where retained audio
  // starts so the earlier monitoring prefix never reaches the transcriber.
  useEffect(() => {
    const capturePhase = state.phase === 'listening'
      || state.phase === 'synthesizing'
      || state.phase === 'speaking';
    if (
      !state.active ||
      state.microphoneMuted ||
      !capturePhase ||
      voice.phase !== 'idle' ||
      (state.phase === 'listening' && turnCycleRef.current)
    ) return;
    voice.start();
  }, [state.active, state.microphoneMuted, state.phase, voice.phase, voice.start]);

  useEffect(() => {
    if (!state.active) return;
    if (voice.phase === 'transcribing') {
      feedback.beginTranscription();
      feedbackTurnActiveRef.current = true;
      dispatch({ type: 'transcribing' });
    } else if (voice.phase === 'error' && voice.errorReason) {
      feedback.endTurn();
      feedbackTurnActiveRef.current = false;
      dispatch({ type: 'failed', reason: voice.errorReason });
    }
  }, [feedback, state.active, voice.errorReason, voice.phase]);

  useEffect(() => {
    if (!state.active) return;
    const previousPhase = previousSpeechPhaseRef.current;
    feedback.setPlayback(speech.phase, speech.currentKind);
    if (speech.phase === 'synthesizing') {
      dispatch({ type: 'synthesizing' });
    } else if (speech.phase === 'speaking') {
      dispatch({ type: 'speaking' });
    } else if (speech.phase === 'error') {
      if (voice.phase === 'recording') voice.cancel();
      dispatch({
        type: 'failed',
        reason: speech.errorReason ?? 'Piper could not play this response.',
      });
    } else if (
      speech.phase === 'idle'
      && (previousPhase === 'synthesizing' || previousPhase === 'speaking')
      && bargeInTransitionRef.current
    ) {
      bargeInTransitionRef.current = false;
    } else if (
      speech.phase === 'idle'
      && (previousPhase === 'synthesizing' || previousPhase === 'speaking')
      && turnCycleRef.current
    ) {
      if (voice.phase === 'recording') voice.cancel();
      const resume = inputRequired
        ? 'waiting-for-input'
        : activeToolActivitiesRef.current.size > 0
          ? 'working'
          : 'thinking';
      dispatch({ type: 'speech-finished', resume });
    }
    previousSpeechPhaseRef.current = speech.phase;
  }, [
    feedback,
    inputRequired,
    speech.currentKind,
    speech.errorReason,
    speech.phase,
    state.active,
    voice.cancel,
    voice.phase,
  ]);

  useEffect(() => {
    if (!state.active) return;
    if (inputRequired === previousInputRequiredRef.current) return;
    previousInputRequiredRef.current = inputRequired;
    if (inputRequired) {
      voice.cancel();
      feedback.inputRequired();
      dispatch({ type: 'input-required' });
    } else {
      feedback.inputResolved();
      dispatch({ type: 'input-resolved' });
    }
  }, [feedback, inputRequired, state.active, voice.cancel]);

  useEffect(() => {
    if (!state.active) return;
    const offStarted = api().subscribe('runner.turn.started', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      if (interruptedTurnIdsRef.current.has(payload.turnId)) return;
      currentTurnIdRef.current = payload.turnId;
    });
    const offEvent = api().subscribe('runner.event', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      const event: MoxxyEvent = payload.event;
      if (interruptedTurnIdsRef.current.has(event.turnId)) return;
      if (currentTurnIdRef.current !== null && event.turnId !== currentTurnIdRef.current) return;
      if (event.type === 'user_prompt') {
        currentTurnIdRef.current ??= event.turnId;
        if (!feedbackTurnActiveRef.current) {
          feedback.beginTurn(event.text);
          feedbackTurnActiveRef.current = true;
        }
        return;
      }
      if (event.type === 'tool_call_approved') {
        currentTurnIdRef.current ??= event.turnId;
        const toolName = toolNamesByCallRef.current.get(event.callId) ?? 'unknown';
        const nextActivity = categorizeVoiceToolActivity(toolName);
        activeToolActivitiesRef.current.set(event.callId, nextActivity);
        setActivity(nextActivity);
        feedback.toolApproved(event.callId, toolName);
        dispatch({ type: 'tool-started' });
        return;
      }
      if (event.type === 'tool_call_requested') {
        currentTurnIdRef.current ??= event.turnId;
        toolNamesByCallRef.current.set(event.callId, event.name);
        return;
      }
      if (event.type === 'tool_result') {
        activeToolActivitiesRef.current.delete(event.callId);
        setActivity([...activeToolActivitiesRef.current.values()].at(-1) ?? null);
        feedback.toolResult(event.callId, event.ok);
        toolNamesByCallRef.current.delete(event.callId);
      }
    });
    const offComplete = api().subscribe('runner.turn.complete', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      if (interruptedTurnIdsRef.current.delete(payload.turnId)) return;
      if (currentTurnIdRef.current !== null && payload.turnId !== currentTurnIdRef.current) return;
      feedback.endTurn();
      feedbackTurnActiveRef.current = false;
      currentTurnIdRef.current = null;
      activeToolActivitiesRef.current.clear();
      setActivity(null);
      toolNamesByCallRef.current.clear();
    });
    return () => {
      offStarted();
      offEvent();
      offComplete();
    };
  }, [feedback, state.active, workspaceId]);

  useEffect(() => {
    if (!state.active) return;
    if (chat.sending || chat.activeTurnId !== null) {
      turnObservedRef.current = true;
    }
  }, [chat.activeTurnId, chat.sending, state.active]);

  useEffect(() => {
    if (
      !state.active
      || !turnCycleRef.current
      || turnObservedRef.current
      || turnRequestPending
      || chat.sending
      || chat.activeTurnId !== null
      || !chat.error
    ) return;
    feedback.endTurn();
    feedbackTurnActiveRef.current = false;
    turnCycleRef.current = false;
    completionTargetRef.current = null;
    currentTurnIdRef.current = null;
    dispatch({ type: 'failed', reason: chat.error });
  }, [
    chat.activeTurnId,
    chat.error,
    chat.sending,
    feedback,
    state.active,
    turnRequestPending,
  ]);

  useEffect(() => {
    if (!state.active) return;
    const turnBusy = turnRequestPending || chat.sending || chat.activeTurnId !== null;
    const waitingForTurn =
      state.phase === 'thinking' ||
      state.phase === 'working' ||
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
    feedback.close();
  }, [feedback]);

  return {
    active: state.active,
    phase: state.phase,
    activity,
    errorReason: state.errorReason,
    microphoneMuted: state.microphoneMuted,
    waitingSoundEnabled,
    localPiperInstallRequired,
    localPiperInstalling,
    lastTranscript,
    inputAnalyser,
    outputAnalyser,
    open,
    close,
    retry,
    installLocalPiper,
    muteMicrophone,
    unmuteMicrophone,
    toggleWaitingSound,
    finishUtterance,
    restartListening,
    bargeIn,
  };
}
