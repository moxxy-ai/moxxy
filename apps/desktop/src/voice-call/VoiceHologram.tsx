import type { VoiceCallPhase } from '@moxxy/client-core';
import { useVoiceHologramScene } from './useVoiceHologramScene';
import { useVoicePulse } from './useVoicePulse';

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
  const canvasRef = useVoiceHologramScene({ phase, occupiedSlots });
  const pulseRef = useVoicePulse({ phase, inputAnalyser, outputAnalyser });

  return (
    <div
      ref={pulseRef}
      className={`voice-hologram voice-hologram--${phase}${microphoneMuted ? ' is-muted' : ''}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="voice-hologram-canvas" data-testid="voice-hologram-canvas" />
      <span className="voice-hologram-pulse" />
    </div>
  );
}
