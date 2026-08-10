import type { VoiceCallPhase } from '@moxxy/client-core';

export interface VoiceModeStatus {
  readonly title: string;
  readonly detail: string;
}

const STATUS: Readonly<Record<VoiceCallPhase, VoiceModeStatus>> = Object.freeze({
  idle: { title: 'Voice mode', detail: 'Ready to start' },
  checking: { title: 'Preparing', detail: 'Checking microphone and Local Piper' },
  arming: { title: 'Preparing microphone', detail: 'The microphone will be ready in a moment' },
  listening: { title: 'Listening', detail: 'Speak naturally. You can still type.' },
  transcribing: { title: 'Transcribing', detail: 'Turning your voice into text' },
  thinking: { title: 'Thinking', detail: 'Using the context from this conversation' },
  working: { title: 'Working', detail: 'Operations remain visible until they finish' },
  'waiting-for-input': { title: 'Needs your input', detail: 'Answer the request to continue' },
  synthesizing: { title: 'Preparing voice', detail: 'Local Piper is generating the next sentence' },
  speaking: { title: 'Speaking', detail: 'Speak at any time to interrupt' },
  paused: { title: 'Microphone off', detail: 'Moxxy will not listen until you turn it back on' },
  error: { title: 'Voice mode stopped', detail: 'Resolve the issue and try again' },
});

export function resolveVoicePhaseStatus(phase: VoiceCallPhase): VoiceModeStatus {
  return STATUS[phase];
}

export function resolveVoiceModeStatus({
  phase,
  microphoneMuted,
  localPiperInstallRequired,
  localPiperInstalling,
}: {
  readonly phase: VoiceCallPhase;
  readonly microphoneMuted: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
}): VoiceModeStatus {
  if (localPiperInstallRequired) {
    return localPiperInstalling
      ? { title: 'Installing local voice', detail: 'Downloading the offline voice package' }
      : { title: 'Local voice required', detail: 'Install Local Piper once to use Voice Mode' };
  }

  const status = resolveVoicePhaseStatus(phase);
  if (phase === 'speaking' && microphoneMuted) {
    return { title: status.title, detail: 'The microphone will stay off after this answer' };
  }
  return status;
}
