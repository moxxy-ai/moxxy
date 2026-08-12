import type {
  AudioSpectrumAnalyser,
  FocusAudioSource,
} from './focus-audio-visualization';
import { useSpectroBackground } from './useSpectroBackground.js';

export function SpectroBackground({
  analyser,
  source,
}: {
  readonly analyser: AudioSpectrumAnalyser;
  readonly source: FocusAudioSource;
}): JSX.Element {
  const canvasRef = useSpectroBackground(analyser);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="focus-audio-waveform"
      data-audio-source={source}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        zIndex: 0,
        pointerEvents: 'none',
        filter: 'blur(10px) saturate(1.2)',
        WebkitFilter: 'blur(10px) saturate(1.2)',
        opacity: 0.95,
      }}
    />
  );
}
