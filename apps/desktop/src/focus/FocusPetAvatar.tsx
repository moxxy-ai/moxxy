import type { VoiceCallPhase } from '@moxxy/client-core';
import { MoxxyMark } from '@/components/MoxxyMark';
import { VoiceRadioWaves } from '../voice-call/VoiceRadioWaves';
import { useVoicePulse } from '../voice-call/useVoicePulse';
import { FocusVoiceLiveIndicator } from './FocusVoiceLiveIndicator';
import { style } from './focus-styles';
import { useFocusPetMotion } from './useFocusPetMotion';

/** Rendered size of the mark inside the widget's dock, in CSS pixels. Leaves a
 *  margin inside the 84×104 tile for the accent bloom and the live indicator. */
const FOCUS_MARK_SIZE = 70;

/** Dumb Focus-mode rendering shell; animation policy lives in reusable hooks. */
export function FocusPetAvatar({
  phase,
  microphoneMuted,
  voiceModeActive,
  showRadioWaves = false,
  inputAnalyser,
  outputAnalyser,
}: {
  readonly phase: VoiceCallPhase;
  readonly microphoneMuted: boolean;
  readonly voiceModeActive: boolean;
  readonly showRadioWaves?: boolean;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
}): JSX.Element {
  const pulseRef = useVoicePulse({ phase, inputAnalyser, outputAnalyser });
  const motionRef = useFocusPetMotion(phase);
  const voiceCarrying = phase === 'listening' || phase === 'speaking';

  return (
    <div
      ref={pulseRef}
      data-testid="focus-pet"
      data-phase={phase}
      className={`focus-pet focus-pet--${phase}${microphoneMuted ? ' focus-pet--microphone-muted' : ''}`}
      style={style.focusPet}
      aria-hidden="true"
    >
      {showRadioWaves && <VoiceRadioWaves side="left" active={voiceCarrying} />}
      <span
        style={showRadioWaves
          ? { ...style.focusPetCore, ...style.focusPetCoreWithWaves }
          : style.focusPetCore}
      >
        <span className="focus-pet-glow" style={style.focusPetGlow} />
        <div ref={motionRef} style={style.focusPetMotionLayer}>
          <div data-testid="focus-pet-mark" className="focus-pet-mark" style={style.focusPetMark}>
            <MoxxyMark size={FOCUS_MARK_SIZE} />
          </div>
        </div>
        {voiceModeActive && <FocusVoiceLiveIndicator phase={phase} />}
      </span>
      {showRadioWaves && <VoiceRadioWaves side="right" active={voiceCarrying} />}
    </div>
  );
}
