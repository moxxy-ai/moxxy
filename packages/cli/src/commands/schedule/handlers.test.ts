import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleStore } from '@moxxy/plugin-scheduler';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { addSchedule, parseIsoAt } from './handlers.js';

describe('parseIsoAt', () => {
  it('accepts a full ISO-8601 instant with Z', () => {
    expect(parseIsoAt('2026-07-01T09:00:00Z')).toBe(Date.parse('2026-07-01T09:00:00Z'));
  });

  it('accepts an offset and a date-only form', () => {
    expect(parseIsoAt('2026-07-01T09:00:00+02:00')).toBe(Date.parse('2026-07-01T09:00:00+02:00'));
    expect(parseIsoAt('2026-07-01')).toBe(Date.parse('2026-07-01'));
  });

  it('rejects impossible calendar values that bare Date.parse would coerce', () => {
    // '2026-13-99' has a valid ISO *shape* but is not a real date — Date.parse
    // returns NaN for it, so parseIsoAt rejects it.
    expect(parseIsoAt('2026-13-99')).toBeUndefined();
  });

  it('rejects locale / free-form strings (no implementation-defined parsing)', () => {
    expect(parseIsoAt('next tuesday')).toBeUndefined();
    expect(parseIsoAt('July 1 2026')).toBeUndefined();
    expect(parseIsoAt('07/01/2026')).toBeUndefined();
    expect(parseIsoAt('')).toBeUndefined();
    expect(parseIsoAt('   ')).toBeUndefined();
  });
});

describe('moxxy schedule add --from/--until (time window)', () => {
  let dir: string;
  let store: ScheduleStore;
  const now = Date.parse('2026-10-28T18:00:00Z');
  const add = (flags: Record<string, string>) =>
    addSchedule(store, { command: 'schedule', positional: ['add', 'book-night'], flags });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-cli-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    // The command prints its result; keep the test output clean.
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await removeDir(dir);
  });

  it('creates a recurring schedule limited to the window', async () => {
    const code = await add({
      cron: '*/30 * * * *',
      prompt: 'continue the book',
      from: '2026-10-29T22:00:00Z',
      until: '2026-10-30T06:00:00Z',
    });
    expect(code).toBe(0);
    const [entry] = await store.list();
    expect(entry).toMatchObject({
      cron: '*/30 * * * *',
      startAt: Date.parse('2026-10-29T22:00:00Z'),
      endAt: Date.parse('2026-10-30T06:00:00Z'),
    });
  });

  it.each([
    ['a window on a one-shot', { at: '2026-10-29T22:00:00Z', until: '2026-10-30T06:00:00Z' }],
    ['an end before the start', { cron: '*/30 * * * *', from: '2026-10-30T06:00:00Z', until: '2026-10-29T22:00:00Z' }],
    ['a window that is already over', { cron: '*/30 * * * *', from: '2026-10-23T21:00:00Z', until: '2026-10-24T05:00:00Z' }],
    ['a start that is not a timestamp', { cron: '*/30 * * * *', from: 'tonight' }],
    ['a one-shot in the past', { at: '2026-10-27T09:00:00Z' }],
    ['an unknown time zone', { cron: '0 9 * * *', timezone: 'Mars/Base' }],
  ])('refuses %s and saves nothing', async (_what, flags) => {
    expect(await add({ prompt: 'p', ...flags })).toBe(2);
    expect(await store.list()).toHaveLength(0);
  });
});
