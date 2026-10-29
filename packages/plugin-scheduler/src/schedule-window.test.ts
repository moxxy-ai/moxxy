import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext, ToolDef } from '@moxxy/sdk';
import { assertDefined, zodToJsonSchema } from '@moxxy/sdk';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { isDue, nextCronFire, SchedulerPoller } from './poller.js';
import { ScheduleStore, type ScheduleEntry } from './store.js';
import { buildSchedulerTools } from './tools.js';

/**
 * A recurring schedule limited to a time window: "every 30 minutes from
 * 23:00 until 07:00, then stop". Captured from a real chat where the model,
 * having no field for the window, kept sending `cron` + `runAt` together and
 * every call was rejected.
 */

const ctx = {} as ToolContext;
const windowStart = new Date(2026, 9, 23, 23, 0, 0).getTime();
const windowEnd = new Date(2026, 9, 24, 7, 0, 0).getTime();
const beforeWindow = new Date(2026, 9, 23, 18, 34, 0).getTime();
const MINUTE = 60_000;

function windowEntry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: 'book',
    name: 'book-work',
    prompt: 'continue the book',
    cron: '*/30 * * * *',
    startAt: windowStart,
    endAt: windowEnd,
    enabled: true,
    source: 'manual',
    createdAt: beforeWindow,
    ...overrides,
  };
}

describe('schedule window — firing decision', () => {
  it('does not fire before the window opens', () => {
    expect(isDue(windowEntry(), windowStart - MINUTE)).toBe(false);
  });

  it('fires first exactly when the window opens', () => {
    expect(nextCronFire(windowEntry())?.getTime()).toBe(windowStart);
    expect(isDue(windowEntry(), windowStart)).toBe(true);
  });

  it('waits for the next whole minute when the window opens mid-minute', () => {
    // Cron fires on whole minutes; a start at 23:00:30 must not fire at 23:00:00.
    const entry = windowEntry({ cron: '* * * * *', startAt: windowStart + 30_000 });
    expect(isDue(entry, windowStart + 5_000)).toBe(false);
    expect(nextCronFire(entry)?.getTime()).toBe(windowStart + MINUTE);
  });

  it('still fires the run that falls exactly on the end time', () => {
    const entry = windowEntry({ lastRunAt: windowEnd - 30 * MINUTE });
    expect(isDue(entry, windowEnd)).toBe(true);
  });

  it('still fires the last run when the poller notices it a little after the end time', () => {
    // The poller ticks every 30 s and a previous run may still be busy, so the
    // 07:00 run is usually picked up at 07:00:xx, after `endAt` itself.
    const entry = windowEntry({ lastRunAt: windowEnd - 30 * MINUTE });
    expect(isDue(entry, windowEnd + 20_000)).toBe(true);
    expect(isDue(entry, windowEnd + 4 * MINUTE)).toBe(true);
  });

  it('never fires a missed run long after the window closed (e.g. the computer was asleep)', () => {
    const entry = windowEntry({ lastRunAt: windowEnd - 30 * MINUTE });
    expect(isDue(entry, windowEnd + 2 * 60 * MINUTE)).toBe(false);
  });
});

describe('schedule window — poller over a whole night', () => {
  let dir: string;
  let store: ScheduleStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-window-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
    // Only the wall clock is controlled; timers and file I/O stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(beforeWindow);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await removeDir(dir);
  });

  it('fires every 30 minutes from 23:00 to 07:00 and then turns itself off', async () => {
    await store.create({
      name: 'book-work',
      prompt: 'continue the book',
      cron: '*/30 * * * *',
      startAt: windowStart,
      endAt: windowEnd,
    });
    const firedAt: number[] = [];
    const poller = new SchedulerPoller({
      store,
      // The model call is the external boundary; record when it was asked.
      runner: {
        runPrompt: async () => {
          firedAt.push(Date.now());
          return { text: 'done' };
        },
      },
      inbox: { dir: path.join(dir, 'inbox') },
    });

    // Like the real poller: a tick every 30 s, never exactly on the minute.
    for (let t = windowStart - 10 * MINUTE + 20_000; t <= windowEnd + 60 * MINUTE; t += 30_000) {
      vi.setSystemTime(t);
      await poller.tickOnce();
    }

    expect(firedAt).toHaveLength(17);
    expect(firedAt[0]).toBe(windowStart + 20_000);
    expect(firedAt.at(-1)).toBe(windowEnd + 20_000);
    const [entry] = await store.list();
    assertDefined(entry, 'the window schedule');
    expect(entry.enabled).toBe(false);
  });
});

describe('schedule_create — time window', () => {
  let dir: string;
  let store: ScheduleStore;
  let create: ToolDef;

  const parse = (input: Record<string, unknown>) => create.inputSchema.safeParse(input);
  const issues = (input: Record<string, unknown>): string => {
    const r = parse(input);
    return r.success ? '' : r.error.issues.map((i) => i.message).join(' | ');
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-window-tool-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(beforeWindow);
    const found = buildSchedulerTools({
      store,
      runner: { runPrompt: async () => ({ text: 'ok' }) },
    }).find((t) => t.name === 'schedule_create');
    assertDefined(found, 'schedule_create tool is registered');
    create = found;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await removeDir(dir);
  });

  it('creates a recurring schedule limited to a window', async () => {
    const r = parse({
      name: 'book-work',
      prompt: 'continue the book',
      cron: '*/30 * * * *',
      startAt: new Date(windowStart).toISOString(),
      endAt: new Date(windowEnd).toISOString(),
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const out = (await create.handler(r.data, ctx)) as Record<string, unknown>;

    expect(out).toMatchObject({ startAt: windowStart, endAt: windowEnd, nextFireAt: windowStart });
    const [entry] = await store.list();
    expect(entry).toMatchObject({ cron: '*/30 * * * *', startAt: windowStart, endAt: windowEnd });
  });

  it('tells the model to use startAt/endAt when it sends cron together with runAt', () => {
    const message = issues({ name: 'x', prompt: 'p', cron: '*/30 * * * *', runAt: windowStart });
    expect(message).toMatch(/startAt/);
    expect(message).toMatch(/endAt/);
  });

  it('rejects a window on a one-shot schedule', () => {
    expect(issues({ name: 'x', prompt: 'p', runAt: windowStart, endAt: windowEnd })).toMatch(/cron/);
  });

  it('rejects a window that ends before it starts', () => {
    expect(
      issues({ name: 'x', prompt: 'p', cron: '*/30 * * * *', startAt: windowEnd, endAt: windowStart }),
    ).toMatch(/endAt/);
  });

  it('refuses a window that is already over instead of saving a schedule that never runs', async () => {
    vi.setSystemTime(windowEnd + 3 * 24 * 60 * MINUTE);
    const r = parse({
      name: 'late',
      prompt: 'p',
      cron: '*/30 * * * *',
      startAt: windowStart,
      endAt: windowEnd,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    await expect(create.handler(r.data, ctx)).rejects.toThrow(/already/);
    expect(await store.list()).toHaveLength(0);
  });

  it('refuses a one-shot moment that already passed, and tells the model to ask again', async () => {
    const r = parse({ name: 'late', prompt: 'p', runAt: beforeWindow - 60 * MINUTE });
    expect(r.success).toBe(true);
    if (!r.success) return;
    await expect(create.handler(r.data, ctx)).rejects.toThrow(/already passed.*ask the user/);
    expect(await store.list()).toHaveLength(0);
  });

  it('still takes a run set for right now', async () => {
    const r = parse({ name: 'now', prompt: 'p', runAt: beforeWindow - 10_000 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    await create.handler(r.data, ctx);
    expect(await store.list()).toHaveLength(1);
  });

  it('describes the trigger fields to the model', () => {
    const json = zodToJsonSchema(create.inputSchema) as {
      properties: Record<string, { description?: string }>;
    };
    for (const field of ['cron', 'runAt', 'startAt', 'endAt']) {
      expect(json.properties[field]?.description, field).toBeTruthy();
    }
  });
});
