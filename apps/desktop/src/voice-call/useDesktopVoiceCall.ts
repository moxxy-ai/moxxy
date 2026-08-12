import {
  chatStore,
  useQueuedTurns,
  useVoiceCall,
  type UseVoiceCallOptions,
} from '@moxxy/client-core';
import { useCallback } from 'react';
import { useVoiceActivityDetection } from './useVoiceActivityDetection';
import { VOICE_WAITING_TONE } from './voice-waiting-tone';
import type { DesktopVoiceCallSurface } from './desktop-voice-call-bridge';
import {
  useDesktopVoiceCallBridge,
  type DesktopVoiceCallBridgeResult,
} from './useDesktopVoiceCallBridge';
import { useRealtimeVoiceCaptureLease } from './useRealtimeVoiceCaptureLease';

export type UseDesktopVoiceCallOptions = Omit<UseVoiceCallOptions, 'waitingTone'> & {
  readonly surface: DesktopVoiceCallSurface;
};

/** Desktop adapter shared by the full chat and the compact Focus surface. */
export function useDesktopVoiceCall(
  options: UseDesktopVoiceCallOptions,
): DesktopVoiceCallBridgeResult {
  const { surface, ...callOptions } = options;
  const localCall = useVoiceCall({ ...callOptions, waitingTone: VOICE_WAITING_TONE });
  const queuedTurns = useQueuedTurns(callOptions.workspaceId);
  const dropQueuedTurn = useCallback((id: string): void => {
    chatStore.dropFromQueue(callOptions.workspaceId, id);
  }, [callOptions.workspaceId]);
  useRealtimeVoiceCaptureLease(localCall.active, surface);

  useVoiceActivityDetection({
    analyser: localCall.inputAnalyser,
    outputAnalyser: localCall.outputAnalyser,
    active: localCall.active
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
    localCall,
    queuedTurns,
    dropQueuedTurn,
  });
}
