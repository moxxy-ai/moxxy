/**
 * Full-screen splash, shown until the first ConnectionSnapshot arrives. The
 * mark turns a quarter at a time; being geometric it holds up at this size,
 * where the old raster did not.
 */

import { MoxxyMark } from '@/components/MoxxyMark';
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
      <MoxxyMark size={64} className="moxxy-avatar-loader" />
      <p
        className="mono"
        style={{
          margin: 0,
          fontSize: 'var(--type-row)',
          color: 'var(--color-text-muted)',
          letterSpacing: '0.04em',
        }}
      >
        {message}
      </p>
    </div>
  );
}
