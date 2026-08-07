import type { VoiceCallPhase } from '@moxxy/client-core';
import type { VoiceModeStatus } from './useVoiceModePresentation';
import type { VoiceOrbitView } from './voice-orbit';
import { VoiceActiveOrbit } from './VoiceActiveOrbit';
import { VoiceHologram } from './VoiceHologram';

export function VoicePresenceStage({
  phase,
  status,
  orbit,
  microphoneMuted,
  inputAnalyser,
  outputAnalyser,
}: {
  readonly phase: VoiceCallPhase;
  readonly status: VoiceModeStatus;
  readonly orbit: VoiceOrbitView;
  readonly microphoneMuted: boolean;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
}): JSX.Element {
  return (
    <section className="voice-presence-stage" aria-label="Voice presence">
      <VoiceHologram
        phase={phase}
        microphoneMuted={microphoneMuted}
        inputAnalyser={inputAnalyser}
        outputAnalyser={outputAnalyser}
        occupiedSlots={orbit.items.map((item) => item.slot)}
      />
      <VoiceActiveOrbit orbit={orbit} />
      <div className="voice-call-status" role="status" aria-live="polite">
        <strong>{status.title}</strong>
        <span>{status.detail}</span>
      </div>
    </section>
  );
}
