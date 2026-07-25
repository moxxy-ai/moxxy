import { describe, expect, it } from 'vitest';

import { projectNativeBrowserBounds } from './native-browser-geometry.js';

describe('projectNativeBrowserBounds', () => {
  it('maps renderer CSS coordinates into BrowserWindow DIP coordinates', () => {
    expect(
      projectNativeBrowserBounds({
        rect: { x: 600, y: 120, width: 400, height: 500 },
        rendererViewport: { width: 1000, height: 700 },
        contentBounds: { width: 1250, height: 875 },
      }),
    ).toEqual({ x: 750, y: 150, width: 500, height: 625 });
  });

  it('clamps a partially off-screen rect to the content area', () => {
    expect(
      projectNativeBrowserBounds({
        rect: { x: -20, y: 680, width: 500, height: 100 },
        rendererViewport: { width: 1000, height: 700 },
        contentBounds: { width: 1000, height: 700 },
      }),
    ).toEqual({ x: 0, y: 680, width: 480, height: 20 });
  });

  it('rejects non-finite or empty geometry instead of producing invalid Electron bounds', () => {
    expect(() =>
      projectNativeBrowserBounds({
        rect: { x: 0, y: 0, width: Number.NaN, height: 100 },
        rendererViewport: { width: 1000, height: 700 },
        contentBounds: { width: 1000, height: 700 },
      }),
    ).toThrow(/geometry/i);
    expect(() =>
      projectNativeBrowserBounds({
        rect: { x: 0, y: 0, width: 0, height: 100 },
        rendererViewport: { width: 1000, height: 700 },
        contentBounds: { width: 1000, height: 700 },
      }),
    ).toThrow(/geometry/i);
  });
});
