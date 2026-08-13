import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDependencySnapshot,
  npmPackageUrl,
  resolvedDependenciesFromPnpmList,
  submitDependencySnapshot,
} from './dependency-snapshot.mjs';

test('npmPackageUrl encodes scoped package names and versions', () => {
  assert.equal(
    npmPackageUrl('@hono/node-server', '2.1.0'),
    'pkg:npm/%40hono/node-server@2.1.0',
  );
  assert.equal(npmPackageUrl('pkg', '1.0.0+build'), 'pkg:npm/pkg@1.0.0%2Bbuild');
});

test('resolvedDependenciesFromPnpmList folds workspace trees into one stable graph', () => {
  const shared = { from: 'shared', version: '3.0.0' };
  const workspaces = [
    {
      name: 'app',
      dependencies: {
        '@scope/runtime': {
          from: '@scope/runtime',
          version: '1.2.3',
          dependencies: { shared },
        },
        internal: {
          from: 'internal',
          version: 'link:packages/internal',
          dependencies: {
            nested: { from: 'nested', version: '4.0.0' },
          },
        },
        'aliased-package': {
          from: 'canonical-package',
          version: '5.0.0',
        },
      },
      devDependencies: {
        shared,
        devonly: { from: 'devonly', version: '2.0.0' },
      },
    },
  ];

  const resolved = resolvedDependenciesFromPnpmList(workspaces);
  assert.deepEqual(Object.keys(resolved), [...Object.keys(resolved)].sort());
  assert.equal(resolved['pkg:npm/%40scope/runtime@1.2.3'].relationship, 'direct');
  assert.equal(resolved['pkg:npm/%40scope/runtime@1.2.3'].scope, 'runtime');
  assert.deepEqual(resolved['pkg:npm/%40scope/runtime@1.2.3'].dependencies, [
    'pkg:npm/shared@3.0.0',
  ]);
  assert.equal(resolved['pkg:npm/shared@3.0.0'].relationship, 'direct');
  assert.equal(resolved['pkg:npm/shared@3.0.0'].scope, 'runtime');
  assert.equal(resolved['pkg:npm/devonly@2.0.0'].scope, 'development');
  assert.equal(resolved['pkg:npm/nested@4.0.0'].relationship, 'indirect');
  assert.equal(resolved['pkg:npm/canonical-package@5.0.0'].relationship, 'direct');
  assert.equal('pkg:npm/aliased-package@5.0.0' in resolved, false);
  assert.equal('pkg:npm/internal@link%3Apackages%2Finternal' in resolved, false);
});

test('buildDependencySnapshot binds the graph to the exact development commit', () => {
  const snapshot = buildDependencySnapshot(
    [{ name: 'app', dependencies: { pkg: { from: 'pkg', version: '1.0.0' } } }],
    {
      sha: 'a'.repeat(40),
      ref: 'refs/heads/development',
      jobId: '123.1',
      jobUrl: 'https://github.com/moxxy-ai/moxxy/actions/runs/123',
      scanned: '2026-08-12T00:00:00.000Z',
    },
  );
  assert.equal(snapshot.sha, 'a'.repeat(40));
  assert.equal(snapshot.ref, 'refs/heads/development');
  assert.equal(snapshot.job.correlator, 'moxxy-pnpm-resolved');
  assert.equal(snapshot.manifests['pnpm-lock.yaml'].resolved['pkg:npm/pkg@1.0.0'].scope, 'runtime');
});

test('buildDependencySnapshot refuses to replace the graph with an empty snapshot', () => {
  assert.throws(
    () => buildDependencySnapshot([], {
      sha: 'a'.repeat(40),
      ref: 'refs/heads/development',
      jobId: '123.1',
      jobUrl: 'https://example.test',
      scanned: '2026-08-12T00:00:00.000Z',
    }),
    /empty dependency snapshot/,
  );
});

test('submitDependencySnapshot posts only to the repository snapshot endpoint', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ result: 'SUCCESS' }), { status: 201 });
  };
  const snapshot = { version: 0 };

  const result = await submitDependencySnapshot(snapshot, 'token-value', fetchImpl);

  assert.equal(request.url, 'https://api.github.com/repos/moxxy-ai/moxxy/dependency-graph/snapshots');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.authorization, 'Bearer token-value');
  assert.equal(request.init.body, JSON.stringify(snapshot));
  assert.deepEqual(result, { result: 'SUCCESS' });
});
