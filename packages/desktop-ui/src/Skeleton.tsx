/**
 * Skeleton primitives — render a shimmery placeholder that matches the
 * shape of the content it stands in for.
 *
 * Self-sufficient: this primitive injects its own `@keyframes moxxy-shimmer`
 * (so a consumer that loads `@moxxy/design-tokens` but not the desktop's
 * styles.css still animates) and honors `prefers-reduced-motion` at runtime
 * (matchMedia) rather than relying on the host app's reduced-motion override.
 *
 * Use `<Skeleton.Line />` for a single text-line placeholder and
 * `<Skeleton.Row />` for a left-icon + label row (the desks/workflows
 * default shape).
 */

import { useEffect, useState } from 'react';

const SHIMMER_STYLE_ID = 'moxxy-shimmer-keyframes';

// Inject the keyframes once per document so the primitive renders correctly for
// any consumer that doesn't ship the desktop's styles.css. Idempotent + SSR-safe.
function ensureShimmerKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SHIMMER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SHIMMER_STYLE_ID;
  style.textContent =
    '@keyframes moxxy-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
  document.head.appendChild(style);
}

// Track prefers-reduced-motion so the shimmer is dropped when the user asks for
// it, without depending on the host app's @media override. SSR-safe (no match
// until mounted in a browser).
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

const baseStyle: React.CSSProperties = {
  display: 'inline-block',
  // Canonical @moxxy/design-tokens vars (NOT the desktop-only `--color-bg-card*`
  // aliases) so this primitive renders correctly for any consumer that loads
  // design-tokens without the desktop's styles.css alias layer. card-bg → the
  // recessed input-soft tone → card-bg gives the shimmer its contrast in both
  // light and dark themes.
  background:
    'linear-gradient(90deg, var(--color-card-bg) 0%, var(--color-input-soft) 50%, var(--color-card-bg) 100%)',
  backgroundSize: '200% 100%',
  animation: 'moxxy-shimmer 1.4s ease-in-out infinite',
  borderRadius: 4,
};

function Line({
  width = '100%',
  height = 10,
  style,
}: {
  readonly width?: number | string;
  readonly height?: number;
  readonly style?: React.CSSProperties;
}): JSX.Element {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    ensureShimmerKeyframes();
  }, []);
  // Drop the looping animation (and the 200% scroll surface it pans) when the
  // user prefers reduced motion; the static gradient still reads as a placeholder.
  const animated: React.CSSProperties = reduced
    ? { ...baseStyle, animation: undefined, backgroundSize: undefined }
    : baseStyle;
  return <span aria-hidden style={{ ...animated, width, height, ...style }} />;
}

function Row(): JSX.Element {
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.4rem 1rem',
      }}
    >
      <Line width={8} height={8} style={{ borderRadius: '50%' }} />
      <Line width="60%" />
    </div>
  );
}

function Card({ lines = 2 }: { readonly lines?: number }): JSX.Element {
  return (
    <div
      aria-hidden
      style={{
        padding: '0.65rem 0.85rem',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-block)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}
    >
      <Line width="40%" height={12} />
      {Array.from({ length: lines - 1 }).map((_, i) => (
        <Line key={i} width={`${30 + i * 20}%`} height={10} />
      ))}
    </div>
  );
}

export const Skeleton = { Line, Row, Card };
