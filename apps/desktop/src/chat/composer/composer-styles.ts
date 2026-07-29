/**
 * The command bar's send / abort control.
 *
 * A labelled accent button at --frame-control, matching every other control in
 * the frame. It used to be a 38px circle with a coloured glow: the glow is a
 * shadow on a flat surface, which this language does not do, and the size made
 * it a floating object rather than the terminal item in a row of controls.
 *
 * The label carries `--color-on-primary`, never `#fff` — the dark theme's accent
 * is luminous and takes an ink label.
 */
export function sendBtn(bg: string, enabled: boolean): React.CSSProperties {
  return {
    height: 'var(--frame-control)',
    padding: '0 var(--space-8)',
    // A border, even though it is the same colour as the fill. Every other
    // control in the row is border-box with a 1px border, so a borderless one at
    // the same height renders 2px more fill and reads as a different species of
    // object sitting in the input rather than as the row's last control.
    border: `1px solid ${bg}`,
    borderRadius: 'var(--radius-block)',
    background: bg,
    color: 'var(--color-on-primary)',
    fontSize: 'var(--type-meta)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-6)',
    opacity: enabled ? 1 : 0.45,
  };
}
