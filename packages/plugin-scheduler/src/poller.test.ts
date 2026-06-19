import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Skill, SkillRegistry } from '@moxxy/sdk';
import { asSkillId } from '@moxxy/sdk';
import { isDue, nextCronFire, SchedulerPoller } from './poller.js';
import { syncSkillSchedules } from './skill-sync.js';
import { ScheduleStore } from './store.js';

function fakeRegistry(skills: ReadonlyArray<Skill>): SkillRegistry {
  const map = new Map(skills.map((s) => [s.frontmatter.name, s] as const));
  return {
    list: () => [...map.values()],
    get: (id: string) => skills.find((s) => s.id === id),
    byName: (name: string) => map.get(name),
    filterByTriggers: () => [],
  };
}

function mkSkill(name: string, schedule: NonNullable<Skill['frontmatter']['schedule']> | undefined, body = 'do the thing'): Skill {
  return {
    id: asSkillId(name),
    path: `/skills/${name}.md`,
    scope: 'user',
    body,
    frontmatter: {
      name,
      description: 'test skill',
      ...(schedule ? { schedule } : {}),
    },
  };
}

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

  it('nextCronFire agrees with isDue for a never-run cron created during downtime (u103-7)', () => {
    // Created 2h ago, hourly cron — the fire that fell ~1h ago was missed
    // while moxxy was off. The displayed next-fire must be the SAME instant
    // the poller fires (in the past, <= now), not anchored at `now`.
    const entry = {
      id: 'x',
      name: 'hourly',
      prompt: 'p',
      cron: '0 * * * *', // top of every hour
      enabled: true,
      source: 'manual' as const,
      createdAt: now - 2 * 60 * 60_000,
    };
    expect(isDue(entry, now)).toBe(true);
    const next = nextCronFire(entry);
    expect(next).not.toBeNull();
    // Agreement: the shown next-fire is <= now exactly because isDue is true.
    expect(next!.getTime()).toBeLessThanOrEqual(now);
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

  it('tickOnce counts a due schedule even when its store.update throws mid-run (u103-8)', async () => {
    await store.create({ name: 'minute', prompt: 'wake up', cron: '* * * * *' });
    const entries = await store.list();
    await store.update(entries[0]!.id, { lastRunAt: Date.now() - 120_000 });

    // Wrap the real store so list() still returns the due row but update()
    // throws — simulating a store-level failure during the run. The attempt
    // must still be counted (it fired-and-failed), not silently dropped.
    const throwingStore = Object.assign(Object.create(Object.getPrototypeOf(store) as object), store, {
      list: () => store.list(),
      update: async () => {
        throw new Error('store update failed');
      },
    }) as ScheduleStore;

    const poller = new SchedulerPoller({
      store: throwingStore,
      runner: { runPrompt: async ({ prompt }) => ({ text: `did: ${prompt}` }) },
      inbox: { dir: inboxDir },
    });
    const fired = await poller.tickOnce();
    expect(fired).toBe(1);
  });

  it('does NOT re-fire a one-shot whose disable-write keeps throwing (u-refire)', async () => {
    await store.create({ name: 'once', prompt: 'fire', runAt: Date.now() - 1000 });

    // list() returns the still-enabled due row (the disable patch never lands
    // because update() always throws). Without the in-memory firedKeys guard
    // the prompt's real side effects would re-run on every tick.
    const throwingStore = Object.assign(Object.create(Object.getPrototypeOf(store) as object), store, {
      list: () => store.list(),
      update: async () => {
        throw new Error('store update failed');
      },
    }) as ScheduleStore;

    const calls: string[] = [];
    const poller = new SchedulerPoller({
      store: throwingStore,
      runner: {
        runPrompt: async ({ prompt }) => {
          calls.push(prompt);
          return { text: 'done' };
        },
      },
      inbox: { dir: inboxDir },
    });

    await poller.tickOnce();
    await poller.tickOnce();
    await poller.tickOnce();
    // Fired exactly once despite three ticks and a persistently-failing write.
    expect(calls).toEqual(['fire']);
  });

  it('one bad-timeZone row never aborts evaluation of the rows after it (u-tz)', async () => {
    // Synthesize a store snapshot with a malformed (non-IANA) timeZone on the
    // FIRST row and a genuinely-due row after it. A throw from the first row's
    // isDue would, pre-fix, unwind the for-loop and the second row would never
    // fire. Bypass the store schema (which now rejects such a zone) to model a
    // legacy/hand-edited row.
    const now = Date.now();
    const badRow = {
      id: 'bad',
      name: 'bad',
      prompt: 'never',
      cron: '* * * * *',
      timeZone: 'Mars/Phobos',
      enabled: true,
      source: 'manual' as const,
      createdAt: now - 120_000,
    };
    const goodRow = {
      id: 'good',
      name: 'good',
      prompt: 'wake up',
      cron: '* * * * *',
      enabled: true,
      source: 'manual' as const,
      createdAt: now - 120_000,
    };
    const fakeStore = Object.assign(Object.create(Object.getPrototypeOf(store) as object), store, {
      list: async () => [badRow, goodRow],
      update: async () => null,
    }) as ScheduleStore;

    const calls: string[] = [];
    const poller = new SchedulerPoller({
      store: fakeStore,
      runner: {
        runPrompt: async ({ prompt }) => {
          calls.push(prompt);
          return { text: 'ok' };
        },
      },
      inbox: { dir: inboxDir },
    });
    const fired = await poller.tickOnce();
    // The bad row is never due (its zone is unusable → null next-fire); the
    // good row after it still fires.
    expect(fired).toBe(1);
    expect(calls).toEqual(['wake up']);
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

  // Regression for u103-2: skill edits/deletes must propagate on a tick,
  // not only on skill_created/boot. The poller, when primed with `skills`,
  // reconciles skill rows each tick.
  it('re-syncs skill schedules every tick: removes a dropped skill row', async () => {
    // Skill exists with a schedule; seed the store as boot would.
    let reg = fakeRegistry([mkSkill('briefing', { cron: '0 9 * * *' })]);
    await syncSkillSchedules(reg, store);
    expect((await store.list()).length).toBe(1);

    // Skill is removed from the registry afterwards.
    reg = fakeRegistry([]);
    const poller = new SchedulerPoller({
      store,
      runner: { runPrompt: async () => ({ text: 'done' }) },
      inbox: { dir: inboxDir },
      skills: reg,
    });
    await poller.tickOnce();
    expect(await store.list()).toEqual([]);
  });

  it('re-syncs skill schedules every tick: updates an in-place cron edit', async () => {
    const skills = [mkSkill('briefing', { cron: '0 9 * * *' }, 'first')];
    const reg = fakeRegistry(skills);
    await syncSkillSchedules(reg, store);

    // Edit the skill's cron in place (no skill_created re-emit). Rebuild the
    // registry view over the edited skill.
    const editedReg = fakeRegistry([mkSkill('briefing', { cron: '0 18 * * *' }, 'second')]);
    const poller = new SchedulerPoller({
      store,
      runner: { runPrompt: async () => ({ text: 'done' }) },
      inbox: { dir: inboxDir },
      skills: editedReg,
    });
    await poller.tickOnce();
    const stored = await store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.cron).toBe('0 18 * * *');
    expect(stored[0]!.prompt).toBe('second');
  });
});
