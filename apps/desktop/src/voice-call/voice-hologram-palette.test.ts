import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokens, darkTokens } from '@moxxy/design-tokens';
import {
  resolvePalette,
  FALLBACK_BACKGROUND,
  FALLBACK_INK,
  FALLBACK_PRIMARY,
  FALLBACK_RED,
} from './useVoiceHologramScene';

function rgb(hex: string): readonly [number, number, number] {
  const m = /^#(..)(..)(..)$/.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  return [parseInt(m[1] ?? '', 16), parseInt(m[2] ?? '', 16), parseInt(m[3] ?? '', 16)];
}

const INK = rgb(darkTokens.color.text);
const ACCENT = rgb(darkTokens.color.primary);
const DARK_BG = rgb(darkTokens.color.mainBg);
const LIGHT_BG = rgb(tokens.color.mainBg);

/**
 * The Harness language spends its whole colour budget on meaning: each hue
 * means exactly one thing, `primary` marks what the human commanded, and
 * "nothing else may borrow it". A visual that quietly warms the accent toward
 * its own preferred red has introduced a second brand hue — which is what this
 * hologram used to do, and what these tests exist to prevent recurring.
 */
describe('voice hologram palette', () => {
  it('takes its fallbacks straight from the design tokens', () => {
    expect(FALLBACK_PRIMARY).toEqual(rgb(darkTokens.color.primary));
    expect(FALLBACK_INK).toEqual(rgb(darkTokens.color.text));
    expect(FALLBACK_RED).toEqual(rgb(darkTokens.color.red));
    expect(FALLBACK_BACKGROUND).toEqual(rgb(darkTokens.color.mainBg));
  });

  it('paints the accent strand in the accent itself, unshifted', () => {
    const dark = resolvePalette(INK, ACCENT, DARK_BG);
    const light = resolvePalette(rgb(tokens.color.text), rgb(tokens.color.primary), LIGHT_BG);

    expect(dark.strandColor[1]).toEqual(ACCENT);
    expect(light.strandColor[1]).toEqual(rgb(tokens.color.primary));
    // ...and the ink strand is the ink, not a tinted variant of it.
    expect(dark.strandColor[0]).toEqual(INK);
  });

  it('never lands on a hue outside the two it was given', () => {
    const dark = resolvePalette(INK, ACCENT, DARK_BG);
    // A mix between palette entries is fine; a NEW hue is not. Every colour the
    // palette produces must sit within the red/green/blue envelope of the
    // inputs plus the neutrals (paper and ink), never outside it.
    const bounds = [INK, ACCENT, DARK_BG, rgb(tokens.color.mainBg), rgb(tokens.color.text)];
    const lowest = [0, 1, 2].map((c) => Math.min(...bounds.map((b) => b[c] ?? 0)));
    const highest = [0, 1, 2].map((c) => Math.max(...bounds.map((b) => b[c] ?? 0)));
    const produced = [
      dark.voidTone,
      ...dark.strandColor,
      ...dark.strandCore,
    ];

    for (const colour of produced) {
      for (const channel of [0, 1, 2]) {
        expect(colour[channel]).toBeGreaterThanOrEqual((lowest[channel] ?? 0) - 0.001);
        expect(colour[channel]).toBeLessThanOrEqual((highest[channel] ?? 255) + 0.001);
      }
    }
  });

  it('keeps raw colour literals out of the hologram source', () => {
    // The palette is resolved from CSS custom properties and the token module;
    // a bare hex or rgb() triple in here means someone has started inventing
    // colours again.
    const dir = resolve(process.cwd(), 'src/voice-call');
    for (const file of ['useVoiceHologramScene.ts', 'voice-hologram-sprites.ts']) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      const body = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
        // The one exemption, and it is not a colour: under `destination-out`
        // a stroke reads only its alpha, so that literal is an eraser.
        .filter((line) => !line.includes('ERASER_ALPHA_ONLY'))
        .join('\n');
      expect(body, `${file} carries a hex colour`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(body, `${file} carries an rgb triple`).not.toMatch(/\[\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\]/);
    }
  });
});
