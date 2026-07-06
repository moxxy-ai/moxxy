import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertDefined } from '@moxxy/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateWorkflow } from './schema.js';
import { WorkflowStore } from './store.js';

let dir: string;
let store: WorkflowStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-wf-'));
  store = new WorkflowStore({ cwd: dir, userDir: path.join(dir, 'user'), projectDir: path.join(dir, 'project') });
  await store.load();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function sample(name: string) {
  const wf = validateWorkflow({ name, description: 'x', steps: [{ id: 'a', prompt: 'go' }] }).workflow;
  assertDefined(wf, 'sample workflow is schema-valid by construction');
  return wf;
}

describe('WorkflowStore CRUD', () => {
  it('creates, lists, and looks up a workflow', async () => {
    const created = await store.create(sample('alpha'), 'user');
    expect(created.scope).toBe('user');
    expect(created.path.endsWith('alpha.yaml')).toBe(true);

    const list = await store.list();
    expect(list.map((w) => w.workflow.name)).toContain('alpha');
    expect(store.lookup('alpha')?.name).toBe('alpha');

    // persisted to disk and rediscovered by a fresh store
    const fresh = new WorkflowStore({ cwd: dir, userDir: path.join(dir, 'user') });
    await fresh.load();
    expect((await fresh.get('alpha'))?.workflow.name).toBe('alpha');
  });

  it('rejects creating a duplicate name', async () => {
    await store.create(sample('beta'), 'user');
    await expect(store.create(sample('beta'), 'user')).rejects.toThrow(/already exists/);
  });

  it('toggles enabled and persists it', async () => {
    await store.create(sample('gamma'), 'user');
    const updated = await store.setEnabled('gamma', false);
    expect(updated?.workflow.enabled).toBe(false);

    const fresh = new WorkflowStore({ cwd: dir, userDir: path.join(dir, 'user') });
    await fresh.load();
    expect((await fresh.get('gamma'))?.workflow.enabled).toBe(false);
  });

  it('deletes a user workflow', async () => {
    await store.create(sample('delta'), 'user');
    const res = await store.delete('delta');
    expect(res.ok).toBe(true);
    expect(await store.get('delta')).toBeUndefined();
  });

  it('renames a workflow without leaving an orphaned file/entry (Finding 7)', async () => {
    const created = await store.create(sample('old-name'), 'user');
    const oldPath = created.path;

    // Save under a new name, declaring the previous name → old file/entry gone.
    const renamed = await store.save(sample('new-name'), 'old-name');
    expect(renamed.workflow.name).toBe('new-name');

    expect(await store.get('old-name')).toBeUndefined();
    expect((await store.get('new-name'))?.workflow.name).toBe('new-name');
    await expect(fs.access(oldPath)).rejects.toThrow();

    // A fresh store rediscovers only the new file (no orphan duplicate).
    const fresh = new WorkflowStore({ cwd: dir, userDir: path.join(dir, 'user') });
    await fresh.load();
    const names = (await fresh.list()).map((w) => w.workflow.name);
    expect(names).toContain('new-name');
    expect(names).not.toContain('old-name');
  });

  it('save without a rename leaves the file in place', async () => {
    await store.create(sample('keep'), 'user');
    const kept = await store.get('keep');
    assertDefined(kept, 'workflow "keep" was just created');
    const before = kept.path;
    const after = await store.save(sample('keep'));
    expect(after.path).toBe(before);
  });

  it('serializes a concurrent reload against a setEnabled (no desync, no empty-map window)', async () => {
    await store.create(sample('one'), 'user');
    await store.create(sample('two'), 'user');

    // A reload (clears+refills byName) racing a toggle (read→write→set) must
    // not interleave. Fire both without awaiting between them.
    const reload = store.load();
    const toggle = store.setEnabled('one', false);
    const [, toggled] = await Promise.all([reload, toggle]);

    // The toggle landed and the reload did not lose the other workflow.
    expect(toggled?.workflow.enabled).toBe(false);
    const names = (await store.list()).map((w) => w.workflow.name).sort();
    expect(names).toEqual(['one', 'two']);

    // In-memory state matches disk (a fresh store sees the same toggle).
    const fresh = new WorkflowStore({ cwd: dir, userDir: path.join(dir, 'user') });
    await fresh.load();
    expect((await fresh.get('one'))?.workflow.enabled).toBe(false);
    expect((await fresh.get('two'))?.workflow.name).toBe('two');
  });
});
