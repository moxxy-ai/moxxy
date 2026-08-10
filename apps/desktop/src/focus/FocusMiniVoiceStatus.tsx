import type { VoiceCallPhase } from '@moxxy/client-core';
import { MoxxyMark } from '@/components/MoxxyMark';
import { VoiceRadioWaves } from '../voice-call/VoiceRadioWaves';
import { resolveVoicePhaseStatus } from '../voice-call/voice-mode-status.js';
import { style } from './focus-styles';

/** Compact, presentation-only Voice Mode presence for the Mini Chat header. */
export function FocusMiniVoiceStatus({
  phase,
}: {
  readonly phase: VoiceCallPhase;
}): JSX.Element {
  const status = resolveVoicePhaseStatus(phase);
  const voiceCarrying = phase === 'listening' || phase === 'speaking';

  return (
    <span
      role="status"
      aria-label={`Voice mode: ${status.title}`}
      aria-live="polite"
      data-phase={phase}
      style={style.miniTitle}
    >
      <VoiceRadioWaves side="left" active={voiceCarrying} variant="compact" />
      <MoxxyMark size={16} />
      <VoiceRadioWaves side="right" active={voiceCarrying} variant="compact" />
      <span>Text</span>
      <span aria-hidden style={style.miniVoiceState}>{status.title}</span>
    </span>
  );
}
