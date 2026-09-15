import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ScheduleStore, type ScheduleEntry } from './store.js';
import { isDue, nextCronFire } from './poller.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const noonDraft: ScheduleEntry = { id: '', name: 'wf-noon', workflowName: 'noon', prompt: 'run noon', source: 'workflow', enabled: true, createdAt: 0, cron: '0 12 * * *', timeZone: 'Europe/Warsaw' };
it('keeps a deletion tombstone when a stale runner syncs a disabled definition', async () => {
  const { store, file } = await fixture(() => Date.now());
  await store.syncWorkflowSchedule('noon', noonDraft);
  const [row] = await store.list();
  if (!row) throw new Error('Missing fixture');
  await store.delete(row.id);
  await store.syncWorkflowSchedule('noon', null);
  const restarted = new ScheduleStore({ file });
  await restarted.syncWorkflowSchedule('noon', noonDraft);
  expect(await restarted.list()).toEqual([]);
});
async function fixture(now: () => number) {
  const dir = await mkdtemp(path.join(tmpdir(), 'moxxy-workflow-clock-'));
  dirs.push(dir);
  const file = path.join(dir, 'schedules.json');
  return { file, store: new ScheduleStore({ file, now }) };
}

it('assigns a real creation time and does not run a new noon workflow in the afternoon', async () => {
  const now = Date.parse('2026-09-12T13:00:00Z');
  const { store } = await fixture(() => now);
  await store.syncWorkflowSchedule('noon', noonDraft);
  const [entry] = await store.list();
  expect(entry?.createdAt).toBe(now);
  if (!entry) throw new Error('missing schedule');
  expect(isDue(entry, now)).toBe(false);
  expect(nextCronFire(entry)?.toISOString()).toBe('2026-09-13T10:00:00.000Z');
});

it('preserves identity, history and a user pause across sync and restart', async () => {
  const now = Date.parse('2026-09-12T13:00:00Z');
  const { store, file } = await fixture(() => now);
  await store.syncWorkflowSchedule('noon', noonDraft);
  const [first] = await store.list();
  if (!first) throw new Error('missing schedule');
  await store.update(first.id, { lastRunAt: now + 1000, lastResult: 'error', lastError: 'fixture', enabled: false });
  const restarted = new ScheduleStore({ file, now: () => now + 2000 });
  await restarted.syncWorkflowSchedule('noon', { ...noonDraft, prompt: 'new instructions' });
  expect((await restarted.list())[0]).toMatchObject({ id: first.id, createdAt: now, lastRunAt: now + 1000, lastResult: 'error', lastError: 'fixture', enabled: false, prompt: 'new instructions' });
});

it('changes the cron baseline without erasing historical execution information', async () => {
  let now = Date.parse('2026-09-12T13:00:00Z');
  const { store } = await fixture(() => now);
  await store.syncWorkflowSchedule('noon', noonDraft);
  const [first] = await store.list();
  if (!first) throw new Error('missing schedule');
  await store.update(first.id, { lastRunAt: now - 86_400_000, lastResult: 'ok' });
  now += 60_000;
  await store.syncWorkflowSchedule('noon', { ...noonDraft, cron: '0 11 * * *' });
  const [changed] = await store.list();
  if (!changed) throw new Error('missing schedule');
  expect(changed.lastRunAt).toBe(first.createdAt - 86_400_000);
  expect(changed.createdAt).toBe(first.createdAt);
  expect(isDue(changed, now)).toBe(false);
  expect(nextCronFire(changed)?.toISOString()).toBe('2026-09-13T09:00:00.000Z');
});

it('persists an idempotent migration of zero workflow dates before returning schedules', async () => {
  let now = Date.parse('2026-09-12T13:00:00Z');
  const { store, file } = await fixture(() => now);
  const history = now - 86_400_000;
  await writeFile(file, JSON.stringify({ version: 1, schedules: [
    { ...noonDraft, id: 'legacy' },
    { ...noonDraft, id: 'history', workflowName: 'other', lastRunAt: history, lastResult: 'ok' },
    { ...noonDraft, id: 'manual', source: 'manual' },
  ] }));
  const entries = await store.list();
  expect(entries.find((e) => e.id === 'legacy')?.createdAt).toBe(now);
  expect(entries.find((e) => e.id === 'history')).toMatchObject({ createdAt: history, lastRunAt: history, lastResult: 'ok' });
  expect(entries.find((e) => e.id === 'manual')?.createdAt).toBe(0);
  const persisted = await readFile(file, 'utf8');
  now += 86_400_000;
  expect(await new ScheduleStore({ file, now: () => now }).list()).toEqual(entries);
  expect(await readFile(file, 'utf8')).toBe(persisted);
});
