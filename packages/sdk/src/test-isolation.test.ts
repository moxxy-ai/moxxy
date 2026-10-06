import { homedir, tmpdir } from 'node:os';
import { isAbsolute, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moxxyHome } from './fs-utils.js';

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

// The shared vitest preset points every test process at a throwaway home, so a
// test can never read or write the developer's real ~/.moxxy or OS keychain.
describe('test isolation', () => {
  it('resolves the home directory inside the temp dir', () => {
    expect(isInside(tmpdir(), homedir())).toBe(true);
  });

  it('resolves the moxxy home inside the temp dir, with no inherited override', () => {
    expect(process.env.MOXXY_HOME).toBeUndefined();
    expect(isInside(tmpdir(), moxxyHome())).toBe(true);
  });

  it('keeps the OS keychain out of reach', () => {
    expect(process.env.MOXXY_NO_KEYCHAIN).toBe('1');
  });
});
