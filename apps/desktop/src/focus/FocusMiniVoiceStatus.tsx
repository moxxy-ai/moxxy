import type { VoiceCallPhase } from '@moxxy/client-core';
import { MoxxyMark } from '@/components/MoxxyMark';
import { VoiceRadioWaves } from '../voice-call/VoiceRadioWaves';
import { style } from './focus-styles';

const MINI_VOICE_LABEL: Readonly<Record<VoiceCallPhase, string>> = Object.freeze({
  idle: "I'm ready",
  checking: "I'm preparing",
  arming: "I'm preparing",
  listening: "I'm listening",
  transcribing: "I'm transcribing",
  thinking: "I'm thinking",
  working: "I'm working",
  'waiting-for-input': 'I need your input',
  synthesizing: "I'm preparing my voice",
  speaking: "I'm speaking",
  paused: "I'm paused",
  error: 'I need attention',
});

export function resolveFocusMiniVoiceLabel(phase: VoiceCallPhase): string {
  return MINI_VOICE_LABEL[phase];
}

/** Compact, presentation-only Voice Mode presence for the Mini Chat header. */
export function FocusMiniVoiceStatus({
  phase,
}: {
  readonly phase: VoiceCallPhase;
}): JSX.Element {
  const label = resolveFocusMiniVoiceLabel(phase);
  const voiceCarrying = phase === 'listening' || phase === 'speaking';

  return (
    <span
      role="status"
      aria-label={`Voice mode: ${label}`}
      aria-live="polite"
      data-phase={phase}
      style={style.miniTitle}
    >
      <VoiceRadioWaves side="left" active={voiceCarrying} variant="compact" />
      <MoxxyMark size={16} />
      <VoiceRadioWaves side="right" active={voiceCarrying} variant="compact" />
      <span>Text</span>
      <span aria-hidden style={style.miniVoiceState}>{label}</span>
    </span>
  );
}
