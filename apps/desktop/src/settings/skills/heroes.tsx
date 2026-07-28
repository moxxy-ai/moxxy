/**
 * Loading state for the Skills editor — the spinner shown inside the editor
 * while a skill's body streams in from disk.
 */

import { MoxxyMark } from '@/components/MoxxyMark';

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
      <MoxxyMark size={64} className="moxxy-avatar-loader moxxy-avatar-loader--sm" />
      Loading…
    </div>
  );
}
