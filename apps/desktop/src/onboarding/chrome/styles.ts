/**
 * Shared inline style tokens for the onboarding chrome and steps — the
 * input `React.CSSProperties` const every step reuses
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
