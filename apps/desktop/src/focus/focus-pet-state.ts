import type { VoiceCallPhase } from '@moxxy/client-core';

export function resolveFocusPetPhase({
  voiceModeActive,
  voiceModePhase,
  recording,
  transcribing,
}: {
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly recording: boolean;
  readonly transcribing: boolean;
}): VoiceCallPhase {
  if (voiceModeActive) return voiceModePhase;
  if (recording) return 'listening';
  if (transcribing) return 'transcribing';
  return 'idle';
}

const ATTENTION_PHASES = new Set<VoiceCallPhase>([
  'transcribing',
  'thinking',
  'working',
  'waiting-for-input',
  'synthesizing',
]);

/** A single phase transition can attract attention; stable work never loops a hop. */
export function shouldNudgeFocusPet(
  previous: VoiceCallPhase,
  next: VoiceCallPhase,
): boolean {
  return previous !== next && ATTENTION_PHASES.has(next);
}
