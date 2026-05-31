import type { ModeBadge } from './types';

/** Accent + tinted fill per tone, matched to the composer's ModeBanner so the
 *  chip and banner read as one signal: amber for attention, cyan for info. */
function badgeAccent(tone: ModeBadge['tone']): { readonly accent: string; readonly soft: string } {
  return tone === 'info'
    ? { accent: 'var(--color-accent-strong)', soft: 'rgba(34, 211, 238, 0.10)' }
    : { accent: 'var(--color-amber)', soft: 'rgba(245, 158, 11, 0.10)' };
}

/**
 * The Mode chip — a flat native-select chip. Modes have no sub-list to
 * disclose, so the styled chip overlays a transparent native `<select>`
 * for the actual picking + a11y / keyboard behaviour.
 *
 * When the active mode advertises a `badge` (e.g. goal mode), the chip wears
 * a matching accent border + tinted fill so it's visibly "hot" — reinforcing
 * the composer's mode banner.
 */
export function ChipSelect({
  label,
  value,
  options,
  badge,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<string>;
  readonly badge?: ModeBadge | null;
  readonly disabled: boolean;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  const accent = badge ? badgeAccent(badge.tone) : null;
  return (
    <label
      className="btn-chip"
      title={label}
      style={{
        position: 'relative',
        padding: '6px 10px',
        fontSize: 12.5,
        color: 'var(--color-text-muted)',
        border: `1px solid ${accent?.accent ?? 'var(--color-card-border)'}`,
        borderRadius: 10,
        background: accent ? accent.soft : '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'border-color 140ms ease, box-shadow 140ms ease',
      }}
    >
      <span style={{ color: 'var(--color-text-dim)' }}>{label}:</span>
      <span
        style={{
          fontWeight: 600,
          color: accent?.accent ?? 'var(--color-text)',
          maxWidth: 120,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value || '—'}
      </span>
      <span aria-hidden style={{ color: 'var(--color-text-dim)' }}>
        ▾
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
