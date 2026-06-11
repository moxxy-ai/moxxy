import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildExpoStartArgs,
  resolveMobileExpoAppDir,
  resolveMobileExpoOptions,
} from './expo-launcher.js';

describe('mobile Expo launcher', () => {
  it('starts the bundled full mobile-plugin Expo app by default', () => {
    expect(resolveMobileExpoOptions()).toEqual({
      enabled: true,
      host: 'lan',
      port: 8081,
    });
  });

  it('can be disabled for bridge-only mobile runs', () => {
    expect(resolveMobileExpoOptions({ 'no-expo': true })).toEqual({
      enabled: false,
      host: 'lan',
      port: 8081,
    });
  });

  it('builds the Expo start command Expo Go can scan', () => {
    expect(buildExpoStartArgs({ host: 'lan', port: 8081 })).toEqual([
      'run',
      'start',
      '--',
      '--host',
      'lan',
      '--port',
      '8081',
    ]);
  });

  it('resolves the repo mobile-plugin app from the package directory', () => {
    const expected = fileURLToPath(new URL('../../../apps/mobile-plugin/mobile', import.meta.url));

    expect(resolveMobileExpoAppDir()).toBe(expected);
  });
});
