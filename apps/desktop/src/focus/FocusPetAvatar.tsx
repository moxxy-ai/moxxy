import type { VoiceCallPhase } from '@moxxy/client-core';
import { useVoiceAvatarAnimation } from '../voice-call/useVoiceAvatarAnimation';
import { FocusVoiceLiveIndicator } from './FocusVoiceLiveIndicator';
import { style } from './focus-styles';
import { useFocusPetMotion } from './useFocusPetMotion';

/** Dumb Focus-mode rendering shell; animation policy lives in reusable hooks. */
export function FocusPetAvatar({
  phase,
  microphoneMuted,
  voiceModeActive,
  inputAnalyser,
  outputAnalyser,
}: {
  readonly phase: VoiceCallPhase;
  readonly microphoneMuted: boolean;
  readonly voiceModeActive: boolean;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
}): JSX.Element {
  const canvasRef = useVoiceAvatarAnimation({
    phase,
    inputAnalyser,
    outputAnalyser,
    assetSet: 'focus',
  });
  const motionRef = useFocusPetMotion(phase);

  return (
    <div
      data-testid="focus-pet"
      data-phase={phase}
      className={`focus-pet focus-pet--${phase}${microphoneMuted ? ' focus-pet--microphone-muted' : ''}`}
      style={style.focusPet}
      aria-hidden="true"
    >
      <span className="focus-pet-glow" style={style.focusPetGlow} />
      <div ref={motionRef} style={style.focusPetMotionLayer}>
        <canvas
          ref={canvasRef}
          data-testid="focus-pet-canvas"
          data-avatar-assets="focus"
          className="focus-pet-canvas"
          style={style.focusPetCanvas}
        />
      </div>
      {voiceModeActive && <FocusVoiceLiveIndicator phase={phase} />}
    </div>
  );
}
