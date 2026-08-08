import { describe, expect, it } from 'vitest';
import { buildVoiceHologramField } from './voice-hologram-field';
import {
  buildBackdropSprite,
  buildFlareSprite,
  buildMarkSprite,
  mix,
  resolveSpriteCacheKey,
  resolveSpriteSize,
  rgba,
  FLARE_SPRITE_SPAN,
  MARK_SPRITE_SPAN,
  SPRITE_NOMINAL_ENERGY,
  type HologramPalette,
} from './voice-hologram-sprites';

const PALETTE: HologramPalette = Object.freeze({
  lightTheme: false,
  background: [16, 21, 25] as const,
  voidTone: [5, 6, 9] as const,
  accent: [244, 64, 143] as const,
  strandColor: [[210, 226, 250], [248, 51, 124]] as const,
  strandCore: [[255, 255, 255], [250, 190, 216]] as const,
  blend: 'lighter' as const,
  glowScale: 1,
  traceScale: 1,
});

describe('voice hologram sprites', () => {
  it('leaves room for the bloom and the flare rays inside each sprite', () => {
    // The mark's outer reach is 1 by construction; the sprite has to hold the
    // shadow bloom on top of that, and the flare's long rays reach 1.5x scale.
    expect(MARK_SPRITE_SPAN).toBeGreaterThan(1 + 0.09 + 0.05 * SPRITE_NOMINAL_ENERGY);
    expect(FLARE_SPRITE_SPAN).toBeGreaterThan((0.24 + SPRITE_NOMINAL_ENERGY * 0.06) * 1.5);
  });

  it('keys sprites on a quantised size so a window drag cannot rebuild per pixel', () => {
    const base = { dpr: 2, ink: [228, 235, 239] as const, accent: [244, 64, 143] as const, background: [16, 21, 25] as const };

    // A drag moves the edge a pixel at a time; those all have to share a key.
    const dragged = [1_200, 1_201, 1_207, 1_213].map((width) => (
      resolveSpriteCacheKey({ ...base, width, height: 410 })
    ));
    expect(new Set(dragged).size).toBe(1);
    // A real size change still gets its own sprites.
    expect(resolveSpriteCacheKey({ ...base, width: 1_400, height: 410 })).not.toBe(dragged[0]);
    expect(resolveSpriteCacheKey({ ...base, width: 1_200, height: 620 })).not.toBe(dragged[0]);
    // So do a theme swap, a phase colour and a change of pixel density.
    expect(resolveSpriteCacheKey({ ...base, width: 1_200, height: 410, dpr: 1 })).not.toBe(dragged[0]);
    expect(resolveSpriteCacheKey({
      ...base, width: 1_200, height: 410, accent: [242, 84, 91],
    })).not.toBe(dragged[0]);
    expect(resolveSpriteCacheKey({
      ...base, width: 1_200, height: 410, background: [255, 255, 255],
    })).not.toBe(dragged[0]);

    // The baked size never collapses to zero on a stage that has not laid out.
    expect(resolveSpriteSize(0, 0).width).toBeGreaterThan(0);
    expect(resolveSpriteSize(0, 0).height).toBeGreaterThan(0);
  });

  it('mixes and formats colours without leaking out of range', () => {
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([127.5, 127.5, 127.5]);
    expect(mix([0, 0, 0], [255, 255, 255], -3)).toEqual([0, 0, 0]);
    expect(mix([0, 0, 0], [255, 255, 255], 9)).toEqual([255, 255, 255]);
    expect(rgba([1.4, 2.6, 3], 0.5)).toBe('rgba(1, 3, 3, 0.5)');
  });

  it('degrades to null where the host has no 2D canvas rather than throwing', () => {
    // jsdom has no canvas backend, which is exactly the shape of a hardened
    // renderer with canvas disabled — the hologram must fall back, not crash.
    const field = buildVoiceHologramField({ particleCount: 120, sampleCount: 96 });

    expect(document.createElement('canvas').getContext('2d')).toBeNull();
    expect(buildMarkSprite({ field, radius: 120, dpr: 2, palette: PALETTE })).toBeNull();
    expect(buildFlareSprite({
      radius: 120,
      dpr: 2,
      color: PALETTE.strandColor[0],
      core: PALETTE.strandCore[0],
      lightTheme: false,
    })).toBeNull();
    expect(buildBackdropSprite({
      width: 800,
      height: 400,
      centreX: 400,
      centreY: 180,
      radius: 120,
      dpr: 2,
      palette: PALETTE,
    })).toBeNull();
  });
});
