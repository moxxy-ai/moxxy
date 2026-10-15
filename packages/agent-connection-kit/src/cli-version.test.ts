/** Reading and ordering the versions vendor agent CLIs print. */
import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion } from './cli-version.js';

describe('reading a version', () => {
  it('finds the version in what each CLI prints', () => {
    expect(parseVersion('2.1.296 (Claude Code)\n')).toBe('2.1.296');
    expect(parseVersion('codex-cli 0.155.1')).toBe('0.155.1');
    expect(parseVersion('1.18.35')).toBe('1.18.35');
    expect(parseVersion('2.0.0-beta.3')).toBe('2.0.0-beta.3');
    expect(parseVersion('no version here')).toBeNull();
  });

  it('orders versions by their numbers, a pre-release before its release', () => {
    expect(compareVersions('2.1.296', '2.1.30')).toBeGreaterThan(0);
    expect(compareVersions('0.155.1', '0.161.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.0.0-beta.3', '2.0.0')).toBeLessThan(0);
  });
});

