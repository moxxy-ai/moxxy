/**
 * Full-screen splash — shown until the first ConnectionSnapshot
 * arrives. A plain ring spinner (brand pink) rather than the logo mark,
 * which read poorly on this large, empty cold-start surface.
 */

import './styles.css';

export function Splash({
  message = 'Getting things ready…',
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
        gap: '1.25rem',
        // Match the chat surface bg so the cold-start splash feels
        // continuous with the app's first useful screen.
        background: 'var(--color-main-bg)',
        color: 'var(--color-text)',
      }}
    >
      <span className="moxxy-splash-spinner" aria-hidden="true" />
      <p
        className="mono"
        style={{
          margin: 0,
          fontSize: '0.85rem',
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}
      >
        {message}
      </p>
    </div>
  );
}
