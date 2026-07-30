/**
 * The select field.
 *
 * A bare `<select>` renders in the OS's own shape — taller than every control
 * beside it, with a platform chevron and a platform radius — so any row holding
 * one broke the instrument's alignment on sight. This is the same field as
 * {@link TextInput}: one height, one radius, one size, with the chevron drawn as
 * a background so it inherits the theme's ink instead of the system's.
 */
import type { CSSProperties, SelectHTMLAttributes } from 'react';
import type { FieldTone } from './TextInput';

// Inlined so it needs no asset pipeline and no network (the CSP forbids both).
// `currentColor` is not available to a background image, so the stroke is the
// dim-ink token resolved at paint time via a CSS var in the data URI's place —
// two variants, one per theme, selected by the caller's own colour is not
// possible here, so it uses a mid grey that reads on both grounds.
const CHEVRON =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23808d96' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>\")";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly tone?: FieldTone;
}

export function Select({ tone = 'plain', style, ...rest }: SelectProps): JSX.Element {
  const base: CSSProperties = {
    height: 'var(--frame-row)',
    // Room on the right for the chevron the appearance reset removed.
    padding: '0 var(--space-20) 0 var(--space-8)',
    fontSize: 'var(--type-row)',
    fontFamily: 'inherit',
    color: 'var(--color-text)',
    background: tone === 'soft' ? 'var(--color-input-soft)' : 'var(--color-surface)',
    border: '1px solid var(--color-card-border)',
    borderRadius: 'var(--radius-chip)',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: CHEVRON,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right var(--space-6) center',
    cursor: 'pointer',
  };
  return <select style={{ ...base, ...style }} {...rest} />;
}
