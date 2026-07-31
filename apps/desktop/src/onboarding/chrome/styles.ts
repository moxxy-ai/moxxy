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
