import { describe, expect, it } from 'vitest';
import type { ResolvedPluginManifest } from '@moxxy/sdk';
import { PluginCycleError, toposortPluginManifests } from './toposort.js';

const m = (
  packageName: string,
  deps: ReadonlyArray<string> = [],
  extras: ReadonlyArray<{ kind: 'runtime' | 'provider'; name: string }> = [],
): ResolvedPluginManifest => ({
  entry: './dist/index.js',
  packageName,
  packageVersion: '0.0.0',
  packagePath: `/tmp/${packageName}`,
  requirements: [
    ...deps.map((d) => ({ kind: 'plugin' as const, name: d })),
    ...extras,
  ],
});

describe('toposortPluginManifests', () => {
  it('orders dependencies before dependents', () => {
    const ordered = toposortPluginManifests([
      m('dependent', ['base']),
      m('base'),
    ]);

    expect(ordered.map((p) => p.packageName)).toEqual(['base', 'dependent']);
  });

  it('handles a longer chain', () => {
    const ordered = toposortPluginManifests([
      m('c', ['b']),
      m('a'),
      m('b', ['a']),
    ]);

    expect(ordered.map((p) => p.packageName)).toEqual(['a', 'b', 'c']);
  });

  it('ignores non-plugin requirement kinds', () => {
    const ordered = toposortPluginManifests([
      m('only-runtime', [], [{ kind: 'runtime', name: 'auth:ready' }]),
      m('only-provider', [], [{ kind: 'provider', name: 'openai-codex' }]),
    ]);

    expect(ordered.map((p) => p.packageName).sort()).toEqual(['only-provider', 'only-runtime']);
  });

  it('leaves unknown plugin dependencies in place for the readiness gate to reject later', () => {
    const ordered = toposortPluginManifests([
      m('dependent', ['unknown']),
      m('other'),
    ]);

    expect(ordered.map((p) => p.packageName).sort()).toEqual(['dependent', 'other']);
  });

  it('throws PluginCycleError on a cycle', () => {
    expect(() =>
      toposortPluginManifests([
        m('a', ['b']),
        m('b', ['a']),
      ]),
    ).toThrow(PluginCycleError);
  });
});
