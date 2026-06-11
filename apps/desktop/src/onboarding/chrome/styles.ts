/**
 * Shared inline style tokens for the onboarding chrome and steps — the
 * input / button / picker `React.CSSProperties` consts every step reuses
 * so the wizard's controls stay visually identical. A dependency leaf
 * (no React component code), imported by both the primitives and the
 * individual step components.
 */

export const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 10,
  outline: 'none',
};

export const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  background: 'var(--grad-cta)',
  border: 'none',
  borderRadius: 10,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 10px 20px -12px color-mix(in srgb, var(--color-primary) 55%, transparent)',
};

export const secondaryBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: '1px solid var(--color-card-border)',
  borderRadius: 10,
};

export const pickerBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  fontSize: 13,
  color: 'var(--color-text)',
  background: 'var(--color-input-soft)',
  border: '1px dashed var(--color-card-border-strong)',
  borderRadius: 10,
  textAlign: 'left',
  width: '100%',
};
