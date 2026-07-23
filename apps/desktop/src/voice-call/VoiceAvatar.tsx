import type { VoiceCallPhase } from '@moxxy/client-core';
import { useVoiceAvatarAnimation } from './useVoiceAvatarAnimation';

/** Presentational shell for Moxxy. Animation and audio analysis live in the hook. */
export function VoiceAvatar({
  phase,
  microphoneMuted,
  inputAnalyser,
  outputAnalyser,
}: {
  readonly phase: VoiceCallPhase;
  readonly microphoneMuted: boolean;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
}): JSX.Element {
  const canvasRef = useVoiceAvatarAnimation({ phase, inputAnalyser, outputAnalyser });
  return (
    <div
      className={`voice-avatar voice-avatar--${phase}${microphoneMuted ? ' voice-avatar--microphone-muted' : ''}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="voice-avatar-canvas" />
    </div>
  );
}
