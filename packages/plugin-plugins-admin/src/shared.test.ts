import { describe, expect, it } from 'vitest';
import {
  assertSafeNpmSpec,
  diffSnapshot,
  NPM_NAME_RE,
  packageNameFromSpec,
  type PluginSnapshot,
} from './shared.js';
import { installPluginPackage, removePluginPackage } from './install.js';

describe('assertSafeNpmSpec', () => {
  it('accepts the legitimate spec shapes (npm name, version, git, path)', () => {
    for (const spec of [
      '@moxxy/agent-researcher',
      'left-pad',
      '@scope/pkg@1.2.3',
      'github:moxxy-ai/some-plugin',
      'git+https://example.com/p.git',
      'https://example.com/p.tgz',
      './local/plugin',
      '/abs/path/plugin',
      '~/plugin',
    ]) {
      expect(assertSafeNpmSpec(spec)).toBe(spec.trim());
    }
  });

  it('trims surrounding whitespace', () => {
    expect(assertSafeNpmSpec('  left-pad  ')).toBe('left-pad');
  });

  it('rejects an empty / whitespace-only spec', () => {
    expect(() => assertSafeNpmSpec('')).toThrow(/non-empty/);
    expect(() => assertSafeNpmSpec('   ')).toThrow(/non-empty/);
  });

  it('rejects a flag-like spec (argument injection)', () => {
    for (const evil of ['-g', '--prefix=/tmp/evil', '--registry=http://evil', '-f']) {
      expect(() => assertSafeNpmSpec(evil)).toThrow(/option, not a package/);
    }
  });
});

describe('installPluginPackage / removePluginPackage reject injection before spawning npm', () => {
  it('installPluginPackage refuses a flag-like spec', async () => {
    await expect(installPluginPackage({ packageName: '--registry=http://evil' })).rejects.toThrow(
      /option, not a package/,
    );
  });

  it('removePluginPackage refuses a flag-like spec', async () => {
    await expect(removePluginPackage({ packageName: '-g' })).rejects.toThrow(/option, not a package/);
  });
});

describe('NPM_NAME_RE', () => {
  it('matches bare and scoped names, rejects spaces and versions', () => {
    expect(NPM_NAME_RE.test('left-pad')).toBe(true);
    expect(NPM_NAME_RE.test('@moxxy/plugin-browser')).toBe(true);
    expect(NPM_NAME_RE.test('NOT VALID')).toBe(false);
    expect(NPM_NAME_RE.test('pkg@1.2.3')).toBe(false);
  });
});

describe('packageNameFromSpec', () => {
  it('strips a version/tag from bare and scoped specs', () => {
    expect(packageNameFromSpec('@moxxy/plugin-x@1.2.3')).toBe('@moxxy/plugin-x');
    expect(packageNameFromSpec('left-pad@latest')).toBe('left-pad');
  });

  it('returns plain names unchanged', () => {
    expect(packageNameFromSpec('@moxxy/plugin-x')).toBe('@moxxy/plugin-x');
    expect(packageNameFromSpec('left-pad')).toBe('left-pad');
  });

  it('returns undefined for git/path specs (name not derivable)', () => {
    expect(packageNameFromSpec('github:me/repo')).toBeUndefined();
    expect(packageNameFromSpec('git+https://github.com/me/repo.git')).toBeUndefined();
    expect(packageNameFromSpec('./local/dir')).toBeUndefined();
  });
});

describe('diffSnapshot', () => {
  const empty: PluginSnapshot = {
    tools: [],
    agents: [],
    providers: [],
    modes: [],
    compactors: [],
    channels: [],
  };

  it('returns only the kinds with additions', () => {
    const after: PluginSnapshot = { ...empty, tools: ['a', 'b'], modes: ['m'] };
    expect(diffSnapshot(empty, after)).toEqual({ tools: ['a', 'b'], modes: ['m'] });
  });

  it('reports nothing when after is a subset of before', () => {
    const before: PluginSnapshot = { ...empty, tools: ['a', 'b'] };
    const after: PluginSnapshot = { ...empty, tools: ['a'] };
    expect(diffSnapshot(before, after)).toEqual({});
  });
});
