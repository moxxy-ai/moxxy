import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDue, SchedulerPoller } from './poller.js';
import { ScheduleStore } from './store.js';

describe('isDue', () => {
  const now = new Date(2026, 4, 11, 10, 0, 0).getTime();

  it('cron schedule fires when nextFire is past', () => {
    const entry = {
      id: 'x',
      name: 'a',
      prompt: 'p',
      cron: '* * * * *', // every minute
      enabled: true,
      source: 'manual' as const,
      createdAt: now - 120_000, // 2 minutes ago
    };
    expect(isDue(entry, now)).toBe(true);
  });

  it('disabled schedule is never due', () => {
    expect(
      isDue(
        {
          id: 'x',
          name: 'a',
          prompt: 'p',
          cron: '* * * * *',
          enabled: false,
          source: 'manual',
          createdAt: now - 120_000,
        },
        now,
      ),
    ).toBe(false);
  });

  it('one-shot runAt in past is due', () => {
    expect(
      isDue(
        {
          id: 'x',
          name: 'b',
          prompt: 'p',
          runAt: now - 1000,
          enabled: true,
          source: 'manual',
          createdAt: now - 10_000,
        },
        now,
      ),
    ).toBe(true);
  });

  it('one-shot runAt in future is not due', () => {
    expect(
      isDue(
        {
          id: 'x',
          name: 'b',
          prompt: 'p',
          runAt: now + 60_000,
          enabled: true,
          source: 'manual',
          createdAt: now,
        },
        now,
      ),
    ).toBe(false);
  });
});

describe('SchedulerPoller integration', () => {
  let dir: string;
  let store: ScheduleStore;
  let inboxDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-poller-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
    inboxDir = path.join(dir, 'inbox');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('tickOnce fires a due schedule and writes to the inbox', async () => {
    await store.create({
      name: 'minute',
      prompt: 'wake up',
      cron: '* * * * *',
    });
    // Backdate so it's already due.
    const entries = await store.list();
    await store.update(entries[0]!.id, { lastRunAt: Date.now() - 120_000 });

    const calls: string[] = [];
    const poller = new SchedulerPoller({
      store,
      runner: {
        runPrompt: async ({ prompt }) => {
          calls.push(prompt);
          return { text: `did: ${prompt}` };
        },
      },
      inbox: { dir: inboxDir },
    });
    const fired = await poller.tickOnce();
    expect(fired).toBe(1);
    expect(calls).toEqual(['wake up']);

    const refreshed = await store.list();
    expect(refreshed[0]!.lastRunAt).toBeDefined();
    expect(refreshed[0]!.lastResult).toBe('ok');

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(inboxDir);
    expect(files.some((f) => f.includes('minute'))).toBe(true);
  });

  it('one-shot fires once then disables itself', async () => {
    await store.create({
      name: 'once',
      prompt: 'fire',
      runAt: Date.now() - 1000,
    });
    const poller = new SchedulerPoller({
      store,
      runner: { runPrompt: async () => ({ text: 'done' }) },
      inbox: { dir: inboxDir },
    });
    await poller.tickOnce();
    const after = await store.list();
    expect(after[0]!.enabled).toBe(false);

    // Second tick must not fire it again.
    await poller.tickOnce();
    const stillOnce = await store.list();
    expect(stillOnce[0]!.lastRunAt).toEqual(after[0]!.lastRunAt);
  });

  it('records runner errors on lastResult/lastError', async () => {
    await store.create({
      name: 'broken',
      prompt: 'x',
      cron: '* * * * *',
    });
    const entries = await store.list();
    await store.update(entries[0]!.id, { lastRunAt: Date.now() - 120_000 });

    const poller = new SchedulerPoller({
      store,
      runner: {
        runPrompt: async () => {
          throw new Error('provider exploded');
        },
      },
      inbox: { dir: inboxDir },
    });
    await poller.tickOnce();
    const after = await store.list();
    expect(after[0]!.lastResult).toBe('error');
    expect(after[0]!.lastError).toContain('provider exploded');
  });
});
