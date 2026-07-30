/**
 * Shared inline style tokens for the onboarding chrome and steps — the
 * input / button / picker `React.CSSProperties` consts every step reuses
 * so the wizard's controls stay visually identical. A dependency leaf
 * (no React component code), imported by both the primitives and the
 * individual step components.
 */

export const inputStyle: React.CSSProperties = {
  padding: '0 var(--space-8)',
  height: 'var(--frame-row)',
  fontSize: 'var(--type-row)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 'var(--radius-chip)',
  outline: 'none',
};

/* Same control the rest of the app draws (see Button's BASE): the wizard is the
 * first screen a person meets, so its Continue has to be the button they will
 * keep pressing, not a wizard-shaped one they never see again. `--frame-row` is
 * the one concession — a step's own action reads a notch above a toolbar's. */
export const primaryBtnStyle: React.CSSProperties = {
  height: 'var(--frame-row)',
  padding: '0 var(--space-12)',
  fontSize: 'var(--type-row)',
  fontWeight: 600,
  color: 'var(--color-on-primary)',
  background: 'var(--color-primary)',
  border: '1px solid var(--color-primary)',
  borderRadius: 'var(--radius-chip)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-6)',
};

export const secondaryBtnStyle: React.CSSProperties = {
  height: 'var(--frame-row)',
  padding: '0 var(--space-12)',
  fontSize: 'var(--type-row)',
  fontWeight: 500,
  color: 'var(--color-text-muted)',
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-card-border-strong)',
  borderRadius: 'var(--radius-chip)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-6)',
};

export const pickerBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-8)',
  padding: '0 var(--space-8)',
  height: 'var(--frame-row)',
  fontSize: 'var(--type-row)',
  color: 'var(--color-text)',
  background: 'var(--color-input-soft)',
  border: '1px dashed var(--color-card-border-strong)',
  borderRadius: 'var(--radius-chip)',
  textAlign: 'left',
  width: '100%',
};
