import { describe, expect, it } from 'vitest';
import { computeDrift } from './sync.js';

const base = {
  loaded: [] as string[],
  installedSeparately: [] as string[],
  packages: {} as Record<string, { enabled?: boolean } | undefined>,
};

describe('computeDrift', () => {
  it('reports a declared package that is not loaded', () => {
    const d = computeDrift({ ...base, packages: { '@moxxy/plugin-memory': {} } });
    expect(d.missing).toEqual(['@moxxy/plugin-memory']);
  });

  it('is silent when the manifest is satisfied', () => {
    const d = computeDrift({
      ...base,
      loaded: ['@moxxy/plugin-memory'],
      packages: { '@moxxy/plugin-memory': {} },
    });
    expect(d).toEqual({ missing: [], disabledButPresent: [], extra: [] });
  });

  // A package the operator turned off is not missing; it applies on next boot.
  it('does not treat a deliberately disabled package as missing', () => {
    const d = computeDrift({ ...base, packages: { '@moxxy/plugin-memory': { enabled: false } } });
    expect(d.missing).toEqual([]);
  });

  it('separates disabled-but-still-installed from missing', () => {
    const d = computeDrift({
      ...base,
      loaded: ['@moxxy/plugin-memory'],
      packages: { '@moxxy/plugin-memory': { enabled: false } },
    });
    expect(d.disabledButPresent).toEqual(['@moxxy/plugin-memory']);
    expect(d.missing).toEqual([]);
  });

  // The bug this replaced: a name-shape heuristic reported every bundled
  // kernel package as drift, a dozen false lines on a healthy machine.
  it('never reports a bundled package as extra', () => {
    const d = computeDrift({
      ...base,
      loaded: ['@moxxy/plugin-cli', '@moxxy/plugin-vault', '@moxxy/plugin-commands'],
      installedSeparately: [],
      packages: {},
    });
    expect(d.extra).toEqual([]);
  });

  it('reports a separately-installed package that the manifest omits', () => {
    const d = computeDrift({
      ...base,
      loaded: ['@moxxy/plugin-cli', 'some-third-party-plugin'],
      installedSeparately: ['some-third-party-plugin'],
      packages: {},
    });
    expect(d.extra).toEqual(['some-third-party-plugin']);
  });

  it('does not report a separately-installed package the manifest declares', () => {
    const d = computeDrift({
      ...base,
      loaded: ['@moxxy/plugin-memory'],
      installedSeparately: ['@moxxy/plugin-memory'],
      packages: { '@moxxy/plugin-memory': {} },
    });
    expect(d.extra).toEqual([]);
  });
});
