/**
 * Full-screen splash — shown until the first ConnectionSnapshot
 * arrives. Mirrors the blueprint motif used elsewhere so the boot
 * feels continuous instead of a flash-of-blank-then-content.
 *
 * Once IPC reports a phase we hand off to the routed shell; the splash
 * never reappears across the session, so this is purely about the
 * cold-start window.
 */

import './styles.css';

export function Splash({
  message = 'Starting moxxy…',
}: {
  readonly message?: string;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.5rem',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 'var(--radius-block)',
          background:
            'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: '1.5rem',
          color: 'var(--color-bg)',
          boxShadow: '0 0 36px rgba(129, 140, 248, 0.35)',
        }}
      >
        m
      </div>
      <div
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: '2px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)',
          animation: 'moxxy-spin 0.8s linear infinite',
        }}
      />
      <p
        className="mono"
        style={{
          margin: 0,
          fontSize: '0.78rem',
          color: 'var(--color-text-dim)',
          letterSpacing: '0.04em',
        }}
      >
        {message}
      </p>
    </div>
  );
}
