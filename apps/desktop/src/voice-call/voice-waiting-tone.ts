import type { VoiceWaitingToneSource } from '@moxxy/client-core';
import waitingToneUrl from './assets/voice-waiting-loop.ogg?url';

export const VOICE_WAITING_TONE: VoiceWaitingToneSource = Object.freeze({
  audioUrl: waitingToneUrl,
});
