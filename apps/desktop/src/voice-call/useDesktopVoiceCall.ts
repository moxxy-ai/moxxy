import {
  chatStore,
  useQueuedTurns,
  useVoiceCall,
  type UseVoiceCallOptions,
} from '@moxxy/client-core';
import { useCallback, useEffect } from 'react';
import { useVoiceActivityDetection } from './useVoiceActivityDetection';
import { VOICE_WAITING_TONE } from './voice-waiting-tone';
import type { DesktopVoiceCallSurface } from './desktop-voice-call-bridge';
import {
  useDesktopVoiceCallBridge,
  type DesktopVoiceCallBridgeResult,
} from './useDesktopVoiceCallBridge';
import { useRealtimeVoiceCaptureLease } from './useRealtimeVoiceCaptureLease';
import { useGptLiveVoiceCall } from './gpt-live/useGptLiveVoiceCall';
import type { GptLiveTransport } from './gpt-live/gpt-live-transport';
import { useVoiceEnginePreference } from './useVoiceEngine';

export type UseDesktopVoiceCallOptions = Omit<UseVoiceCallOptions, 'waitingTone'> & {
  readonly surface: DesktopVoiceCallSurface;
  /** WebRTC seam for tests; production uses the browser transport. */
  readonly gptLiveTransport?: GptLiveTransport;
};

/** Desktop adapter shared by the full chat and the compact Focus surface. */
export function useDesktopVoiceCall(
  options: UseDesktopVoiceCallOptions,
): DesktopVoiceCallBridgeResult {
  const { surface, gptLiveTransport, ...callOptions } = options;
  const engine = useVoiceEnginePreference();
  const localCall = useVoiceCall({ ...callOptions, waitingTone: VOICE_WAITING_TONE });
  const liveCall = useGptLiveVoiceCall({
    workspaceId: callOptions.workspaceId,
    ready: callOptions.ready,
    chat: callOptions.chat,
    inputRequired: callOptions.inputRequired,
    ...(gptLiveTransport ? { transport: gptLiveTransport } : {}),
  });
  const call = engine === 'gpt-live' ? liveCall : localCall;
  const idleCall = engine === 'gpt-live' ? localCall : liveCall;
  const queuedTurns = useQueuedTurns(callOptions.workspaceId);
  const dropQueuedTurn = useCallback((id: string): void => {
    chatStore.dropFromQueue(callOptions.workspaceId, id);
  }, [callOptions.workspaceId]);
  useRealtimeVoiceCaptureLease(call.active, surface);

  // Switching engines mid-call must not leave the other engine's microphone,
  // peer connection or paid GPT-Live session running unseen.
  const { active: idleCallActive, close: closeIdleCall } = idleCall;
  useEffect(() => {
    if (idleCallActive) closeIdleCall();
  }, [closeIdleCall, idleCallActive]);

  useVoiceActivityDetection({
    analyser: localCall.inputAnalyser,
    outputAnalyser: localCall.outputAnalyser,
    active: engine === 'local'
      && localCall.active
      && !localCall.microphoneMuted
      && (
        localCall.phase === 'listening'
        || localCall.phase === 'synthesizing'
        || localCall.phase === 'speaking'
      ),
    onSpeechStart: localCall.bargeIn,
    onSpeechEnd: localCall.finishUtterance,
    onNoSpeech: localCall.restartListening,
  });

  return useDesktopVoiceCallBridge({
    surface,
    workspaceId: callOptions.workspaceId,
    localCall: call,
    queuedTurns,
    dropQueuedTurn,
  });
}
