import {
  useVoiceCall,
  type UseVoiceCall,
  type UseVoiceCallOptions,
} from '@moxxy/client-core';
import { useVoiceActivityDetection } from './useVoiceActivityDetection';
import { VOICE_WAITING_TONE } from './voice-waiting-tone';
import type { DesktopVoiceCallSurface } from './desktop-voice-call-bridge';
import { useDesktopVoiceCallBridge } from './useDesktopVoiceCallBridge';
import { useRealtimeVoiceCaptureLease } from './useRealtimeVoiceCaptureLease';

export type UseDesktopVoiceCallOptions = Omit<UseVoiceCallOptions, 'waitingTone'> & {
  readonly surface: DesktopVoiceCallSurface;
};

/** Desktop adapter shared by the full chat and the compact Focus surface. */
export function useDesktopVoiceCall(options: UseDesktopVoiceCallOptions): UseVoiceCall {
  const { surface, ...callOptions } = options;
  const localCall = useVoiceCall({ ...callOptions, waitingTone: VOICE_WAITING_TONE });
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
  });
}
