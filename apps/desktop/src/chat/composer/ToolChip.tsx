export function ToolChip({
  children,
  label,
  onClick,
  tone = 'idle',
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly onClick?: () => void;
  readonly tone?: 'idle' | 'recording' | 'busy' | 'armed';
}): JSX.Element {
  /** Hover effect is provided by the global .btn-chip class — adds
   *  a subtle bg + border darken on hover. */
  const palette =
    tone === 'recording'
      ? { bg: 'var(--color-red-soft)', color: 'var(--color-red-text)', border: 'var(--color-red-border)' }
      : tone === 'busy'
        ? { bg: 'var(--color-primary-soft)', color: 'var(--color-primary-strong)', border: 'var(--color-primary-soft)' }
        : tone === 'armed'
          ? { bg: 'var(--color-amber-soft)', color: 'var(--color-amber-text)', border: 'var(--color-amber-border)' }
          : { bg: 'var(--color-surface)', color: 'var(--color-text-muted)', border: 'var(--color-card-border)' };
  return (
    <button
      type="button"
      className="btn-chip"
      aria-label={label}
      onClick={onClick}
      style={{
        padding: '6px 10px',
        fontSize: 12.5,
        color: palette.color,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: palette.bg,
      }}
    >
      {children}
    </button>
  );
}
