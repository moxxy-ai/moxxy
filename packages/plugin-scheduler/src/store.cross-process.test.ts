import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { ScheduleStore } from './store.js';

/**
 * The desktop, the CLI and every runner each hold their own ScheduleStore on
 * the same `schedules.json`. A runner's store used to read the file once and
 * then trust its copy forever: a schedule paused or added elsewhere was never
 * seen, and the runner's next write put its stale copy back over the file.
 */
describe('ScheduleStore shared by several processes', () => {
  let dir: string;
  let file: string;
  let runner: ScheduleStore;
  let desktop: ScheduleStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-xproc-'));
    file = path.join(dir, 'schedules.json');
    runner = new ScheduleStore({ file });
    desktop = new ScheduleStore({ file });
    // The runner has read the (empty) file already, as a running poller has.
    expect(await runner.list()).toEqual([]);
  });
  afterEach(async () => {
    await removeDir(dir);
  });

  it('sees a schedule another process created', async () => {
    await desktop.create({ name: 'from-desktop', prompt: 'p', cron: '0 9 * * *' });
    expect((await runner.list()).map((s) => s.name)).toEqual(['from-desktop']);
  });

  it('sees a pause made by another process', async () => {
    const created = await runner.create({ name: 'nightly', prompt: 'p', cron: '0 9 * * *' });
    await desktop.update(created.id, { enabled: false });
    const [entry] = await runner.list();
    assertDefined(entry, 'the schedule');
    expect(entry.enabled).toBe(false);
  });

  it('does not write its stale copy over a change made elsewhere', async () => {
    const created = await runner.create({ name: 'nightly', prompt: 'p', cron: '0 9 * * *' });
    await desktop.update(created.id, { enabled: false });
    await desktop.create({ name: 'from-desktop', prompt: 'p', cron: '0 10 * * *' });

    // The runner records a run, as the poller does after every fire.
    await runner.update(created.id, { lastRunAt: Date.now() });

    const fresh = new ScheduleStore({ file });
    const all = await fresh.list();
    expect(all.map((s) => s.name).sort()).toEqual(['from-desktop', 'nightly']);
    expect(all.find((s) => s.name === 'nightly')?.enabled).toBe(false);
  });
});
