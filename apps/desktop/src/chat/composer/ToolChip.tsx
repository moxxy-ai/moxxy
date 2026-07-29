/**
 * A control in the command bar's action row.
 *
 * Icon-only by default, at --frame-control (26px) and --radius-block, matching
 * every other control in the frame. The labelled version ("Attach", "Voice",
 * "Voice mode" as pill-shaped 10px-radius chips) made the row the visually
 * heaviest thing in the bar — four word-buttons competing with the one action
 * that matters — and the fast `.tip` tooltip carries the name in 140ms, so the
 * word was paying rent it no longer had to.
 *
 * Pass `label` for the accessible name and the tooltip. Pass `showLabel` where
 * the word genuinely earns its place (a state that must be readable without
 * hovering, like "Listening…").
 */
export function ToolChip({
  children,
  label,
  onClick,
  tone = 'idle',
  pressed,
  disabled = false,
  showLabel = false,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly onClick?: () => void;
  readonly tone?: 'idle' | 'recording' | 'busy' | 'armed';
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly showLabel?: boolean;
}): JSX.Element {
  /** Hover effect is provided by the global .btn-chip class — adds
   *  a subtle bg + border darken on hover. */
  const palette =
    tone === 'recording'
      ? { bg: 'var(--color-red-soft)', color: 'var(--color-red-text)', border: 'var(--color-red-border)' }
      : tone === 'busy'
        ? { bg: 'var(--color-primary-soft)', color: 'var(--color-primary)', border: 'var(--color-primary)' }
        : tone === 'armed'
          ? { bg: 'var(--color-amber-soft)', color: 'var(--color-amber-text)', border: 'var(--color-amber-border)' }
          : { bg: 'var(--color-surface)', color: 'var(--color-text-muted)', border: 'var(--color-card-border)' };
  return (
    <button
      type="button"
      className="btn-chip tip"
      data-tip={label}
      data-tip-side="bottom"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      style={{
        minWidth: 'var(--frame-control)',
        height: 'var(--frame-control)',
        padding: showLabel ? '0 var(--space-8)' : 0,
        fontSize: 'var(--type-meta)',
        color: palette.color,
        border: `1px solid ${palette.border}`,
        borderRadius: 'var(--radius-block)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-6)',
        background: palette.bg,
        opacity: disabled ? 0.48 : 1,
        cursor: disabled ? 'not-allowed' : undefined,
      }}
    >
      {children}
    </button>
  );
}
