import {
  useVoiceCall,
  type UseVoiceCall,
  type UseVoiceCallOptions,
} from '@moxxy/client-core';
import { useVoiceActivityDetection } from './useVoiceActivityDetection';
import { VOICE_WAITING_TONE } from './voice-waiting-tone';

export type UseDesktopVoiceCallOptions = Omit<UseVoiceCallOptions, 'waitingTone'>;

/** Desktop adapter shared by the full chat and the compact Focus surface. */
export function useDesktopVoiceCall(options: UseDesktopVoiceCallOptions): UseVoiceCall {
  const voiceCall = useVoiceCall({ ...options, waitingTone: VOICE_WAITING_TONE });

  useVoiceActivityDetection({
    analyser: voiceCall.inputAnalyser,
    active: voiceCall.active && voiceCall.phase === 'listening',
    onSpeechEnd: voiceCall.finishUtterance,
    onNoSpeech: voiceCall.restartListening,
  });

  return voiceCall;
}
