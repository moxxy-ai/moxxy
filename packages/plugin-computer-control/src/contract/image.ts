import { ComputerUseError } from './outcome.js';

/** Vision input limits: long edge and 28 px tile count, both at most 1568. */
export const IMAGE_LIMITS = { pxPerTile: 28, maxEdgePx: 1568, maxTiles: 1568 } as const;

const tileCount = (width: number, height: number) =>
  Math.ceil(width / IMAGE_LIMITS.pxPerTile) * Math.ceil(height / IMAGE_LIMITS.pxPerTile);
const fits = (width: number, height: number) =>
  width <= IMAGE_LIMITS.maxEdgePx && height <= IMAGE_LIMITS.maxEdgePx && tileCount(width, height) <= IMAGE_LIMITS.maxTiles;

/** Largest size with the same aspect that fits the vision limits; an image that fits is kept as is. */
export function imageBudget(width: number, height: number): [number, number] {
  if (!(width >= 1 && height >= 1)) throw new Error('Image size must be positive');
  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [long, short] = imageBudget(height, width);
    return [short, long];
  }
  const aspect = width / height;
  const heightFor = (w: number) => Math.max(1, Math.round(w / aspect));
  // Binary search the widest width that fits; `low` always fits, `high` never does.
  let low = 1;
  let high = width;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle, heightFor(middle))) low = middle;
    else high = middle;
  }
  return [low, heightFor(low)];
}

export const MIN_SCALE = 0.1;

export function scaledSize([width, height]: readonly [number, number], scale: number): [number, number] {
  if (!(scale >= MIN_SCALE && scale <= 1)) throw new Error(`scale must be a number in [${MIN_SCALE}, 1]`);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

export interface Point { readonly x: number; readonly y: number }
/** How an image maps onto the screen: `bounds` are global screen points and may start left of or above the main display. */
export interface CoordinateFrame {
  readonly image: { readonly width: number; readonly height: number };
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export function imagePointToScreen(point: Point, frame: CoordinateFrame): Point {
  const { image, bounds } = frame;
  const inside = point.x >= 0 && point.y >= 0 && point.x < image.width && point.y < image.height;
  if (!inside) throw new ComputerUseError('point_outside_frame', `Point (${point.x}, ${point.y}) is outside the ${image.width}x${image.height} image`);
  return {
    x: bounds.x + (point.x * bounds.width) / image.width,
    y: bounds.y + (point.y * bounds.height) / image.height,
  };
}
