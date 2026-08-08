import type { VoiceCallPhase } from '@moxxy/client-core';
import { MoxxyMark } from '@/components/MoxxyMark';
import { FocusVoiceLiveIndicator } from './FocusVoiceLiveIndicator';
import { style } from './focus-styles';
import { useFocusMarkAnimation } from './useFocusMarkAnimation';
import { useFocusPetMotion } from './useFocusPetMotion';

/** Rendered size of the mark inside the widget's dock, in CSS pixels. Leaves a
 *  margin inside the 84×104 tile for the accent bloom and the live indicator. */
const FOCUS_MARK_SIZE = 70;

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
  const markRef = useFocusMarkAnimation({ phase, inputAnalyser, outputAnalyser });
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
        <div
          ref={markRef}
          data-testid="focus-pet-mark"
          className="focus-pet-mark"
          style={style.focusPetMark}
        >
          <MoxxyMark size={FOCUS_MARK_SIZE} />
        </div>
      </div>
      {voiceModeActive && <FocusVoiceLiveIndicator phase={phase} />}
    </div>
  );
}
