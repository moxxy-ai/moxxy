import { describe, expect, it } from 'vitest';
import { IMAGE_LIMITS, imageBudget, imagePointToScreen, scaledSize } from './image.js';

const tiles = (width: number, height: number) =>
  Math.ceil(width / IMAGE_LIMITS.pxPerTile) * Math.ceil(height / IMAGE_LIMITS.pxPerTile);

describe('imageBudget', () => {
  it('keeps an image that already fits', () => {
    expect(imageBudget(1000, 800)).toEqual([1000, 800]);
    expect(imageBudget(1, 1)).toEqual([1, 1]);
  });

  it('shrinks a Retina window to the largest size within both limits, keeping its aspect', () => {
    const [width, height] = imageBudget(2880, 1800);
    expect(width).toBeLessThanOrEqual(IMAGE_LIMITS.maxEdgePx);
    expect(height).toBeLessThanOrEqual(IMAGE_LIMITS.maxEdgePx);
    expect(tiles(width, height)).toBeLessThanOrEqual(IMAGE_LIMITS.maxTiles);
    expect(Math.abs(width / height - 1.6)).toBeLessThan(0.01);
    const wider = width + 1;
    expect(tiles(wider, Math.round(wider / 1.6))).toBeGreaterThan(IMAGE_LIMITS.maxTiles);
  });

  it('treats portrait as the mirror of landscape', () => {
    const [width, height] = imageBudget(2880, 1800);
    expect(imageBudget(1800, 2880)).toEqual([height, width]);
  });

  it('never collapses the short edge of an extreme aspect to zero', () => {
    const [width, height] = imageBudget(20_000, 10);
    expect(width).toBeLessThanOrEqual(IMAGE_LIMITS.maxEdgePx);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('rejects an empty image', () => {
    expect(() => imageBudget(0, 10)).toThrow(/positive/);
  });
});

describe('scaledSize', () => {
  it('scales both edges and keeps at least one pixel', () => {
    expect(scaledSize([1000, 500], 0.5)).toEqual([500, 250]);
    expect(scaledSize([3, 3], 0.1)).toEqual([1, 1]);
  });

  it('rejects a scale outside [0.1, 1]', () => {
    expect(() => scaledSize([100, 100], 0)).toThrow(/scale/);
    expect(() => scaledSize([100, 100], 1.5)).toThrow(/scale/);
  });
});

describe('imagePointToScreen', () => {
  const frame = { image: { width: 1000, height: 500 }, bounds: { x: -1440, y: 100, width: 2000, height: 1000 } };

  it('maps an image pixel to global screen points on a display left of the main one', () => {
    expect(imagePointToScreen({ x: 500, y: 250 }, frame)).toEqual({ x: -440, y: 600 });
    expect(imagePointToScreen({ x: 0, y: 0 }, frame)).toEqual({ x: -1440, y: 100 });
  });

  it('maps a downscaled Retina capture back to window points', () => {
    const retina = { image: { width: 1456, height: 910 }, bounds: { x: 200, y: 50, width: 1440, height: 900 } };
    const point = imagePointToScreen({ x: 1456 / 2, y: 910 / 2 }, retina);
    expect(point.x).toBeCloseTo(200 + 720);
    expect(point.y).toBeCloseTo(50 + 450);
  });

  it.each([
    [{ x: 1000, y: 10 }],
    [{ x: -1, y: 10 }],
    [{ x: 10, y: 500 }],
    [{ x: Number.NaN, y: 10 }],
  ])('refuses %j outside the frame', (point) => {
    expect(() => imagePointToScreen(point, frame)).toThrow(expect.objectContaining({ code: 'point_outside_frame' }));
  });
});
