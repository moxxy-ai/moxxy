import './voice-radio-waves.css';

/**
 * Presentational radio-wave fan shared by the main Voice Mode rail and the
 * collapsed Focus pet. Audio sampling and phase policy stay with the parent.
 */
export function VoiceRadioWaves({
  side,
  active,
  variant = 'default',
}: {
  readonly side: 'left' | 'right';
  readonly active: boolean;
  readonly variant?: 'default' | 'compact';
}): JSX.Element {
  return (
    <span
      className={`voice-radio-waves voice-radio-waves--${side} voice-radio-waves--${variant}`}
      data-active={String(active)}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
    </span>
  );
}
