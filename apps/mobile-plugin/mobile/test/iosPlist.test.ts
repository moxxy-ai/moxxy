import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('iOS app plist', () => {
  it('declares background modes used by local Live Activity and notification refreshes', () => {
    const plist = readFileSync(resolve(process.cwd(), 'ios/MoxxyMobileGateway/Info.plist'), 'utf8');

    expect(plist).toContain('<key>UIBackgroundModes</key>');
    expect(plist).toMatch(
      /<key>UIBackgroundModes<\/key>\s*<array>[\s\S]*<string>fetch<\/string>[\s\S]*<string>remote-notification<\/string>[\s\S]*<\/array>/,
    );
  });
});
