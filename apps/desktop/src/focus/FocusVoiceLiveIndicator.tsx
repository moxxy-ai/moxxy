import type { VoiceCallPhase } from '@moxxy/client-core';
import { style } from './focus-styles';

export function FocusVoiceLiveIndicator({
  phase,
}: {
  readonly phase: VoiceCallPhase;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="focus-voice-live"
      data-phase={phase}
      style={style.voiceLiveIndicator}
    />
  );
}
