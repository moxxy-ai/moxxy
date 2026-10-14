import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktop = path.resolve(__dirname, '..', '..');
const brandPng = path.resolve(desktop, '..', '..', 'assets', 'brand', 'png');

function pngHeader(file: string): { width: number; height: number; colourType: number } {
  const png = readFileSync(file);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colourType: png[25] ?? -1 };
}

const RGBA = 6;

describe('desktop brand assets', () => {
  it('ships the cut-out mark every window paints', () => {
    const mark = pngHeader(path.join(desktop, 'public', 'moxxy-mark.png'));
    expect(mark.colourType).toBe(RGBA);
    expect(mark.width).toBe(mark.height);
    // The largest mark on screen is 200px; it has to stay sharp at 2x.
    expect(mark.width).toBeGreaterThanOrEqual(400);
  });

  it('ships the menu-bar template at 1x and 2x and the 1024px app icon', () => {
    expect(pngHeader(path.join(desktop, 'public', 'trayTemplate.png'))).toMatchObject({
      width: 22,
      height: 22,
      colourType: RGBA,
    });
    expect(pngHeader(path.join(desktop, 'public', 'trayTemplate@2x.png'))).toMatchObject({
      width: 44,
      height: 44,
      colourType: RGBA,
    });
    expect(pngHeader(path.join(desktop, 'public', 'logo.png'))).toMatchObject({
      width: 1024,
      height: 1024,
      colourType: RGBA,
    });
  });

  it('ships exactly what the brand build produced', () => {
    // assets/brand/build.sh derives every raster from the one master picture
    // and copies these in; a hand-edited copy would drift from the brand.
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['moxxy-mark.png', 'moxxy-mark-512.png'],
      ['logo.png', 'moxxy-icon-1024.png'],
      ['trayTemplate.png', 'moxxy-mark-template-22.png'],
      ['trayTemplate@2x.png', 'moxxy-mark-template-44.png'],
      ['trayBlinkTemplate.png', 'moxxy-mark-template-blink-22.png'],
      ['trayBlinkTemplate@2x.png', 'moxxy-mark-template-blink-44.png'],
      ['moxxy-mark-eyeless.png', 'moxxy-mark-eyeless-256.png'],
    ];
    for (const [shipped, built] of pairs) {
      expect(
        readFileSync(path.join(desktop, 'public', shipped)).equals(
          readFileSync(path.join(brandPng, built)),
        ),
        `${shipped} should be a copy of assets/brand/png/${built}`,
      ).toBe(true);
    }
  });

  it('ships the eyes the blinking mark draws where the brand build found them', () => {
    const shipped = readFileSync(path.join(desktop, 'src', 'components', 'moxxy-mark-eyes.json'));
    expect(shipped.equals(readFileSync(path.join(brandPng, 'moxxy-mark-eyes.json')))).toBe(true);
  });

  it('ships the closed-eyes menu-bar frame beside the open one', () => {
    // AppKit only treats a file as a template, and pairs it with its @2x, when
    // the name ends in "Template".
    expect(pngHeader(path.join(desktop, 'public', 'trayBlinkTemplate.png'))).toMatchObject({
      width: 22,
      height: 22,
      colourType: RGBA,
    });
    expect(pngHeader(path.join(desktop, 'public', 'trayBlinkTemplate@2x.png'))).toMatchObject({
      width: 44,
      height: 44,
      colourType: RGBA,
    });
  });

  it.each(['index.html', 'focus.html'])(
    '%s paints the same mark before React mounts',
    (page) => {
      const html = readFileSync(path.join(desktop, page), 'utf8');
      expect(html).toMatch(/<img class="mark" src="\/moxxy-mark\.png" alt="moxxy"/);
      expect(html).not.toContain('<svg class="mark"');
    },
  );
});
