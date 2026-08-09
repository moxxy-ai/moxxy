import { describe, expect, it } from 'vitest';
import { buildVoiceHologramField } from './voice-hologram-field';
import {
  buildBackdropSprite,
  buildFlareSprite,
  buildMarkSprite,
  mix,
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
