import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScheduleStore } from './store.js';

describe('ScheduleStore', () => {
  let dir: string;
  let store: ScheduleStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty list when the file is missing', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('round-trips a created schedule through disk', async () => {
    const created = await store.create({
      name: 'morning',
      prompt: 'fetch today\'s headlines',
      cron: '0 9 * * *',
    });
    expect(created.id).toMatch(/^[0-9A-Z]+$/);
    const reloaded = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
    const all = await reloaded.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('morning');
    expect(all[0]!.cron).toBe('0 9 * * *');
    expect(all[0]!.enabled).toBe(true);
  });

  it('rejects schedules with neither cron nor runAt', async () => {
    await expect(
      store.create({ name: 'broken', prompt: 'x' } as never),
    ).rejects.toThrow();
  });

  it('rejects invalid cron', async () => {
    await expect(
      store.create({ name: 'badcron', prompt: 'x', cron: 'not a cron' }),
    ).rejects.toThrow();
  });

  it('update merges patch into an entry', async () => {
    const created = await store.create({ name: 'a', prompt: 'p', cron: '0 9 * * *' });
    const updated = await store.update(created.id, { enabled: false });
    expect(updated!.enabled).toBe(false);
  });

  it('delete removes by id', async () => {
    const a = await store.create({ name: 'a', prompt: 'p', cron: '0 9 * * *' });
    await store.create({ name: 'b', prompt: 'p', cron: '0 10 * * *' });
    expect(await store.delete(a.id)).toBe(true);
    const remaining = await store.list();
    expect(remaining.map((s) => s.name)).toEqual(['b']);
  });

  it('delete hides workflow-sourced schedules from later workflow syncs', async () => {
    await store.syncWorkflowSchedule('daily-report', {
      id: 'workflow-daily-report',
      name: 'daily-report',
      prompt: 'p',
      cron: '0 9 * * *',
      enabled: true,
      createdAt: Date.now(),
      source: 'workflow',
      workflowName: 'daily-report',
    });
    const created = (await store.list())[0]!;

    expect(await store.delete(created.id)).toBe(true);
    expect(await store.list()).toEqual([]);

    await store.syncWorkflowSchedule('daily-report', {
      id: 'workflow-daily-report-next',
      name: 'daily-report',
      prompt: 'p',
      cron: '0 9 * * *',
      enabled: true,
      createdAt: Date.now(),
      source: 'workflow',
      workflowName: 'daily-report',
    });
    expect(await store.list()).toEqual([]);
  });

  it('syncSkillSchedule replaces only skill-sourced rows for that skill', async () => {
    // Mix of manual + skill schedules.
    await store.create({ name: 'manual-one', prompt: 'p', cron: '0 9 * * *' });
    await store.create({
      name: 'skill-old',
      prompt: 'old',
      cron: '0 9 * * *',
      source: 'skill',
      skillName: 'briefing',
    });
    await store.create({
      name: 'other-skill',
      prompt: 'unrelated',
      cron: '0 9 * * *',
      source: 'skill',
      skillName: 'other',
    });

    // Replace the briefing skill schedule.
    const entries = await store.list();
    const briefing = entries.find((e) => e.skillName === 'briefing')!;
    await store.update(briefing.id, { prompt: 'new prompt' });

    const after = await store.list();
    expect(after.map((s) => s.name).sort()).toEqual(['manual-one', 'other-skill', 'skill-old']);
    expect(after.find((s) => s.skillName === 'briefing')!.prompt).toBe('new prompt');
  });
});
