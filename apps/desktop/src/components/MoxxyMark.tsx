import { asset } from '@/lib/asset';

/**
 * The moxxy mark: the cut-out raster `assets/brand/build.sh` ships as
 * `public/moxxy-mark.png`. The mark is a rendered picture (metal ribbon, lit
 * eyes), so it looks the same on every theme and never takes a text colour.
 * Every window paints this one component, so they cannot drift apart.
 */
export function MoxxyMark({
  size = 32,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}): JSX.Element {
  return (
    <img
      src={asset('moxxy-mark.png')}
      width={size}
      height={size}
      className={className}
      alt="moxxy"
      draggable={false}
      style={{ flexShrink: 0 }}
    />
  );
}
