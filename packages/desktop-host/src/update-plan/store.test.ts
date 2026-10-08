import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AppUpdatePlan } from '@moxxy/desktop-ipc-contract';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { createUpdatePlanStore, updatePlanPath } from './store.js';

const root = mkdtempSync(path.join(tmpdir(), 'update-plan-'));
afterAll(() => removeDirSync(root));
const profile = () => mkdtempSync(path.join(root, 'profile-'));

const plan: AppUpdatePlan = {
  id: 'plan-1',
  createdAt: 1_000,
  route: 'hot',
  version: '0.6.0',
  steps: [{ id: 'app', status: 'failed', error: 'offline' }, { id: 'restart', status: 'pending' }],
};

describe('update plan store', () => {
  it('has no plan before any update ran', async () => {
    expect(await createUpdatePlanStore(profile()).read()).toBeNull();
  });

  it('keeps a plan across launches', async () => {
    const userData = profile();
    await createUpdatePlanStore(userData).write(plan);
    expect(await createUpdatePlanStore(userData).read()).toEqual(plan);
  });

  it('keeps the release page of an installer plan', async () => {
    const userData = profile();
    const installer: AppUpdatePlan = { ...plan, route: 'installer', releaseUrl: 'https://github.com/moxxy-ai/moxxy/releases/tag/desktop-v0.6.0' };
    await createUpdatePlanStore(userData).write(installer);
    expect(await createUpdatePlanStore(userData).read()).toEqual(installer);
  });

  it('replaces the earlier plan', async () => {
    const userData = profile();
    const store = createUpdatePlanStore(userData);
    await store.write(plan);
    await store.write({ ...plan, id: 'plan-2' });
    expect((await store.read())?.id).toBe('plan-2');
    expect(JSON.parse(readFileSync(updatePlanPath(userData), 'utf8')).id).toBe('plan-2');
  });

  it('forgets a plan on request', async () => {
    const store = createUpdatePlanStore(profile());
    await store.write(plan);
    await store.clear();
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it('treats a damaged or foreign file as no plan', async () => {
    const userData = profile();
    const store = createUpdatePlanStore(userData);
    await store.write(plan);
    writeFileSync(updatePlanPath(userData), '{"id": 1');
    expect(await store.read()).toBeNull();
    writeFileSync(updatePlanPath(userData), JSON.stringify({ ...plan, steps: [{ id: 'format-disk', status: 'pending' }] }));
    expect(await store.read()).toBeNull();
  });
});
