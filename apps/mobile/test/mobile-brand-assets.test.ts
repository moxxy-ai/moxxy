import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const brandPng = resolve(process.cwd(), '..', '..', 'assets', 'brand', 'png');

function sameFile(shipped: string, built: string): boolean {
  return readFileSync(resolve(process.cwd(), shipped)).equals(readFileSync(resolve(brandPng, built)));
}

describe('mobile brand assets', () => {
  it('ships the app icon the brand build produced, on iOS and in Expo alike', () => {
    expect(sameFile('assets/icon.png', 'moxxy-icon-square-1024.png')).toBe(true);
    expect(
      sameFile(
        'ios/MoxxyMobileGateway/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png',
        'moxxy-icon-square-1024.png',
      ),
    ).toBe(true);
  });

  it('paints the same cut-out mark as the desktop', () => {
    expect(sameFile('assets/moxxy-mark.png', 'moxxy-mark-512.png')).toBe(true);
  });
});
