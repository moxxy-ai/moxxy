import { useId } from 'react';
import { asset } from '@/lib/asset';
import markEyes from './moxxy-mark-eyes.json';

/** How far an eye's glow spreads, as a share of the mark's side. */
const GLOW_BLUR = 0.028;

/**
 * The moxxy mark with eyes that blink: the mark painted without its eyes
 * (`public/moxxy-mark-eyeless.png`), with the two eyes drawn on top where
 * `assets/brand/build.sh` found them. The blink itself is the
 * `.moxxy-mark-blink__eye` animation in styles.css, so nothing here runs a timer.
 *
 * `useId` namespaces the gradient and glow ids: two marks on one screen would
 * otherwise resolve against the first one's definitions.
 */
export function BlinkingMoxxyMark({
  size = 32,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}): JSX.Element {
  const id = useId();
  const lit = `moxxy-eye-lit-${id}`;
  const glow = `moxxy-eye-glow-${id}`;
  return (
    <span
      role="img"
      aria-label="moxxy"
      className={className ? `moxxy-mark-blink ${className}` : 'moxxy-mark-blink'}
      style={{ width: size, height: size }}
    >
      <img src={asset('moxxy-mark-eyeless.png')} alt="" width={size} height={size} draggable={false} />
      <svg className="moxxy-mark-blink__eyes" viewBox="0 0 1 1" aria-hidden="true">
        <defs>
          <radialGradient id={lit}>
            <stop offset="0" stopColor="#ffe0b0" />
            <stop offset="0.5" stopColor="#ffa85a" />
            <stop offset="0.85" stopColor="#ff7a2a" />
            <stop offset="1" stopColor="#ff4a14" />
          </radialGradient>
          <filter id={glow} x="-3" y="-1" width="7" height="3">
            <feGaussianBlur stdDeviation={GLOW_BLUR} />
          </filter>
        </defs>
        {markEyes.eyes.map((eye) => (
          <g key={eye.x} className="moxxy-mark-blink__eye">
            <rect
              x={eye.x}
              y={eye.y}
              width={eye.width}
              height={eye.height}
              rx={eye.width / 2}
              fill="#ff4a1e"
              filter={`url(#${glow})`}
            />
            <rect
              className="moxxy-mark-blink__core"
              x={eye.x}
              y={eye.y}
              width={eye.width}
              height={eye.height}
              rx={eye.width / 2}
              fill={`url(#${lit})`}
            />
          </g>
        ))}
      </svg>
    </span>
  );
}
