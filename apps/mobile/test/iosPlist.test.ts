import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function pngHasAlpha(path: string): boolean {
  const png = readFileSync(path);
  const signature = png.subarray(0, 8).toString('hex');
  expect(signature).toBe('89504e470d0a1a0a');

  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IHDR') {
      const colorType = png[offset + 17];
      if (colorType === 4 || colorType === 6) return true;
    }
    if (type === 'tRNS') return true;
    offset += 12 + length;
  }
  return false;
}

describe('iOS app plist', () => {
  it('uses the public Moxxy Mobile brand name in native metadata and Expo config', () => {
    const plist = readFileSync(resolve(process.cwd(), 'ios/MoxxyMobileGateway/Info.plist'), 'utf8');
    const app = JSON.parse(readFileSync(resolve(process.cwd(), 'app.json'), 'utf8'));

    expect(plist).toContain('<key>CFBundleDisplayName</key>');
    expect(plist).toContain('<string>Moxxy Mobile</string>');
    expect(plist).not.toContain('Moxxy Mobile Gateway');
    expect(plist).not.toContain('$(PRODUCT_NAME) to access');
    expect(app.expo.name).toBe('Moxxy Mobile');
    expect(JSON.stringify(app)).not.toContain('Moxxy Mobile Gateway');
  });

  it('ships opaque iOS app icons so notifications render the Moxxy badge', () => {
    const iconPath = resolve(
      process.cwd(),
      'ios/MoxxyMobileGateway/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png',
    );
    const expoIconPath = resolve(process.cwd(), 'assets/icon.png');

    expect(pngHasAlpha(iconPath)).toBe(false);
    expect(pngHasAlpha(expoIconPath)).toBe(false);
  });

  it('declares background modes used by local Live Activity and notification refreshes', () => {
    const plist = readFileSync(resolve(process.cwd(), 'ios/MoxxyMobileGateway/Info.plist'), 'utf8');

    expect(plist).toContain('<key>UIBackgroundModes</key>');
    expect(plist).toMatch(
      /<key>UIBackgroundModes<\/key>\s*<array>[\s\S]*<string>fetch<\/string>[\s\S]*<string>remote-notification<\/string>[\s\S]*<\/array>/,
    );
  });
});
