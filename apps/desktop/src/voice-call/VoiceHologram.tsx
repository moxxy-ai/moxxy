import type { VoiceCallPhase } from '@moxxy/client-core';
import { useVoiceHologramAnimation } from './useVoiceHologramAnimation';

export function VoiceHologram({
  phase,
  microphoneMuted,
  inputAnalyser,
  outputAnalyser,
  occupiedSlots,
}: {
  readonly phase: VoiceCallPhase;
  readonly microphoneMuted: boolean;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly occupiedSlots: ReadonlyArray<number>;
}): JSX.Element {
  const canvasRef = useVoiceHologramAnimation({
    phase,
    inputAnalyser,
    outputAnalyser,
    occupiedSlots,
  });
  return (
    <div
      className={`voice-hologram voice-hologram--${phase}${microphoneMuted ? ' is-muted' : ''}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="voice-hologram-canvas" data-testid="voice-hologram-canvas" />
    </div>
  );
}
