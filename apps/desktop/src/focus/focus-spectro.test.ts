import { describe, expect, it } from 'vitest';

import {
  projectFocusSpectroLevels,
  resolveFocusSpectroGeometry,
  resolveFocusSpectroGradient,
} from './focus-spectro.js';

describe('Focus Mode spectrogram presentation', () => {
  it('uses the Signal orange semantic palette', () => {
    const tokens = new Map([
      ['--color-primary', '#ff4a1e'],
      ['--color-primary-strong', '#ff8a3d'],
      ['--color-action', '#d62a00'],
    ]);

    expect(resolveFocusSpectroGradient((token) => tokens.get(token) ?? "")).toEqual([
      { offset: 0, color: '#ff8a3d' },
      { offset: 0.55, color: '#ff4a1e' },
      { offset: 1, color: '#d62a00' },
    ]);
  });

  it('projects speech energy symmetrically across the full expanded rail', () => {
    const spectrum = new Uint8Array(256);
    spectrum.fill(220, 0, 24);
    const levels = new Float32Array(64);

    projectFocusSpectroLevels(spectrum, levels);

    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[63]).toBeGreaterThan(0);
    for (let index = 0; index < levels.length / 2; index += 1) {
      expect(levels[index]).toBeCloseTo(levels[levels.length - 1 - index] ?? -1, 6);
    }
  });

  it('lays the final bar against the full canvas edge', () => {
    const geometry = resolveFocusSpectroGeometry(306, 64, 1);
    const finalRightEdge = 63 * geometry.step + geometry.barWidth;

    expect(geometry.barWidth).toBeGreaterThan(1);
    expect(finalRightEdge).toBeCloseTo(306, 6);
  });
});
