import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { discoverApps } from './discover';

let root: string;

const manifest = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    manifestVersion: 1,
    id: 'demo',
    name: 'Demo',
    description: 'A demo app.',
    icon: 'sparkles',
    version: '1.0.0',
    permissions: ['documents.open'],
    ...over,
  });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'moxxy-apps-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeApp(name: string, manifestText: string | null): Promise<void> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  if (manifestText !== null) await writeFile(path.join(dir, 'moxxy-app.json'), manifestText);
}

describe('discoverApps', () => {
  it('returns an empty result when the root does not exist', async () => {
    expect(await discoverApps(path.join(root, 'nope'))).toEqual({ apps: [], skipped: [] });
  });

  it('discovers a valid app folder', async () => {
    await writeApp('demo', manifest());
    const { apps, skipped } = await discoverApps(root);
    expect(skipped).toEqual([]);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.manifest.id).toBe('demo');
    expect(apps[0]!.dir).toBe(path.join(root, 'demo'));
  });

  it('skips a folder whose manifest id != folder name (no masquerade)', async () => {
    await writeApp('demo', manifest({ id: 'other' }));
    const { apps, skipped } = await discoverApps(root);
    expect(apps).toEqual([]);
    expect(skipped[0]?.name).toBe('demo');
    expect(skipped[0]?.reason).toContain('does not match folder name');
  });

  it('skips a malformed manifest but keeps scanning the rest', async () => {
    await writeApp('bad', '{not json');
    await writeApp('good', manifest({ id: 'good' }));
    const { apps, skipped } = await discoverApps(root);
    expect(apps.map((a) => a.manifest.id)).toEqual(['good']);
    expect(skipped.map((s) => s.name)).toEqual(['bad']);
  });

  it('ignores plain asset dirs (no manifest) and non-slug names', async () => {
    await writeApp('assets-only', null); // dir without a manifest
    await writeApp('Bad_Name', manifest({ id: 'Bad_Name' })); // not a valid slug → never considered
    const { apps, skipped } = await discoverApps(root);
    expect(apps).toEqual([]);
    expect(skipped).toEqual([]); // both silently ignored, not "skipped with reason"
  });

  it('sorts discovered apps by id deterministically', async () => {
    await writeApp('zeta', manifest({ id: 'zeta' }));
    await writeApp('alpha', manifest({ id: 'alpha' }));
    const { apps } = await discoverApps(root);
    expect(apps.map((a) => a.manifest.id)).toEqual(['alpha', 'zeta']);
  });
});
