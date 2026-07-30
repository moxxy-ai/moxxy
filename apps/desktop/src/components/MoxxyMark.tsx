import { useId } from 'react';

/**
 * The moxxy mark, inline rather than a raster, so it inherits the surrounding
 * text colour and stays sharp at any size. The ink strand is `currentColor`; the
 * second strand takes the commanded accent.
 *
 * The two strands MUST differ. The interlace is carried entirely by the colour
 * change at each crossing, so painting both in one hue collapses the mark into a
 * solid eight-pointed rosette — which is exactly what happened when a caller set
 * `color` to the accent. Callers set the INK strand via `color`; they never get
 * to pick the second one.
 *
 * `useId` namespaces the mask: two marks on the same screen would otherwise
 * emit duplicate ids and the second would resolve against the first.
 */
export function MoxxyMark({
  size = 32,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}): JSX.Element {
  const maskId = `moxxy-weave-${useId()}`;
  const square = <rect x="68" y="68" width="120" height="120" rx="12" />;
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="moxxy"
      style={{ flexShrink: 0 }}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
        <rect width="256" height="256" fill="#000" />
        <circle cx="188" cy="153" r="27" fill="#fff" />
        <circle cx="103" cy="188" r="27" fill="#fff" />
        <circle cx="68" cy="103" r="27" fill="#fff" />
        <circle cx="153" cy="68" r="27" fill="#fff" />
      </mask>
      <g fill="none" strokeWidth="22" strokeLinejoin="round">
        <g stroke="currentColor">{square}</g>
        <g stroke="var(--color-primary)" transform="rotate(45 128 128)">
          {square}
        </g>
        <g mask={`url(#${maskId})`} stroke="currentColor">
          {square}
        </g>
      </g>
    </svg>
  );
}
