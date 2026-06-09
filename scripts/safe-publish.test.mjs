/**
 * Unit tests for the pure helpers in safe-publish.mjs (topological publish
 * order + post-publish dependency consistency). Run via the root
 * `pnpm test:scripts` (chained into `pnpm test`). Importing safe-publish.mjs is
 * side-effect free — the publish routine only runs when invoked directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  workspaceDepNames,
  topoSortPackages,
  moxxyDepPins,
  findShippedDepProblems,
} from './safe-publish.mjs';

const pkg = (name, version, fields = {}) => ({ dir: `/x/${name}`, pkg: { name, version, ...fields } });

test('workspaceDepNames: only workspace: refs to other publishable packages, shipped fields only', () => {
  const manifest = {
    name: '@moxxy/cli',
    dependencies: {
      '@moxxy/sdk': 'workspace:*', // counts
      '@moxxy/private-thing': 'workspace:*', // not publishable → ignored
      '@moxxy/registry-dep': '^1.0.0', // plain semver → ignored (no order constraint)
      zod: '^3.24.0', // external → ignored
    },
    peerDependencies: { '@moxxy/peer': 'workspace:^' }, // counts
    optionalDependencies: { '@moxxy/opt': 'workspace:*' }, // counts
    devDependencies: { '@moxxy/devonly': 'workspace:*' }, // stripped at publish → ignored
  };
  const publishable = new Set(['@moxxy/cli', '@moxxy/sdk', '@moxxy/peer', '@moxxy/opt', '@moxxy/devonly', '@moxxy/registry-dep']);
  assert.deepEqual(workspaceDepNames(manifest, publishable), ['@moxxy/opt', '@moxxy/peer', '@moxxy/sdk']);
});

test('topoSortPackages: dependencies publish before dependents regardless of readdir order', () => {
  // readdir order would yield cli before sdk (alphabetical) — the exact A12 hazard.
  const input = [
    pkg('@moxxy/cli', '0.7.0', { dependencies: { '@moxxy/sdk': 'workspace:*' } }),
    pkg('@moxxy/sdk', '0.7.0', {}),
  ];
  const order = topoSortPackages(input).map((p) => p.pkg.name);
  assert.deepEqual(order, ['@moxxy/sdk', '@moxxy/cli']);
});

test('topoSortPackages: deterministic, deep chains ordered, unrelated packages name-sorted', () => {
  const input = [
    pkg('@moxxy/c', '1.0.0', { dependencies: { '@moxxy/b': 'workspace:*' } }),
    pkg('@moxxy/zeta', '1.0.0', {}),
    pkg('@moxxy/b', '1.0.0', { dependencies: { '@moxxy/a': 'workspace:*' } }),
    pkg('@moxxy/a', '1.0.0', {}),
  ];
  const order = topoSortPackages(input).map((p) => p.pkg.name);
  assert.deepEqual(order, ['@moxxy/a', '@moxxy/b', '@moxxy/c', '@moxxy/zeta']);
  // Same input shuffled → same order.
  const order2 = topoSortPackages([...input].reverse()).map((p) => p.pkg.name);
  assert.deepEqual(order2, order);
});

test('topoSortPackages: throws loudly on a workspace dependency cycle', () => {
  const input = [
    pkg('@moxxy/a', '1.0.0', { dependencies: { '@moxxy/b': 'workspace:*' } }),
    pkg('@moxxy/b', '1.0.0', { dependencies: { '@moxxy/a': 'workspace:*' } }),
  ];
  assert.throws(() => topoSortPackages(input), /cycle/);
});

test('moxxyDepPins: parses exact and ranged pins, flags unparseable specs', () => {
  const pins = moxxyDepPins({
    dependencies: {
      '@moxxy/sdk': '0.7.0',
      '@moxxy/other': '^1.2.3',
      '@moxxy/weird': 'latest',
      zod: '^3.24.0',
    },
    peerDependencies: { '@moxxy/peer': '~2.0.1-rc.1' },
  });
  assert.deepEqual(pins, [
    { name: '@moxxy/sdk', spec: '0.7.0', version: '0.7.0' },
    { name: '@moxxy/other', spec: '^1.2.3', version: '1.2.3' },
    { name: '@moxxy/weird', spec: 'latest', version: null },
    { name: '@moxxy/peer', spec: '~2.0.1-rc.1', version: '2.0.1-rc.1' },
  ]);
});

test('findShippedDepProblems: clean when every shipped pin exists', async () => {
  const problems = await findShippedDepProblems(
    [{ name: '@moxxy/cli', version: '0.7.0' }],
    {
      shippedManifest: async () => ({ dependencies: { '@moxxy/sdk': '0.7.0', zod: '^3.24.0' } }),
      versionExists: async (name, version) => name === '@moxxy/sdk' && version === '0.7.0',
    },
  );
  assert.deepEqual(problems, []);
});

test('findShippedDepProblems: reports a pin on a version missing from the registry', async () => {
  // The A12 scenario: cli shipped pinned to sdk@0.7.0 but sdk tombstone-bumped to 0.7.1.
  const problems = await findShippedDepProblems(
    [{ name: '@moxxy/cli', version: '0.7.0' }],
    {
      shippedManifest: async () => ({ dependencies: { '@moxxy/sdk': '0.7.0' } }),
      versionExists: async (name, version) => !(name === '@moxxy/sdk' && version === '0.7.0'),
    },
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].problem, /@moxxy\/sdk@0\.7\.0/);
  assert.match(problems[0].problem, /does NOT exist/);
});

test('findShippedDepProblems: unreadable manifest and unparseable spec are problems', async () => {
  const problems = await findShippedDepProblems(
    [
      { name: '@moxxy/cli', version: '0.7.0' },
      { name: '@moxxy/sdk', version: '0.7.0' },
    ],
    {
      shippedManifest: async (name) =>
        name === '@moxxy/cli' ? null : { dependencies: { '@moxxy/x': 'latest' } },
      versionExists: async () => true,
    },
  );
  assert.equal(problems.length, 2);
  assert.match(problems[0].problem, /could not read/);
  assert.match(problems[1].problem, /unparseable/);
});
