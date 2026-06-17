/**
 * Loading state for the Skills editor — the spinner shown inside the editor
 * while a skill's body streams in from disk.
 */

import { asset } from '@/lib/asset';

export function LoadingHero(): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--color-text-dim)',
        fontSize: 13,
        gap: 10,
      }}
    >
      <img
        src={asset('new-animation.gif')}
        alt=""
        aria-hidden
        className="moxxy-avatar-loader moxxy-avatar-loader--sm"
        style={{ width: 64, height: 'auto', imageRendering: 'pixelated' }}
      />
      Loading…
    </div>
  );
}
