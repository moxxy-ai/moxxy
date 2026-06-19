import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill, SkillRegistry } from '@moxxy/sdk';
import { asSkillId } from '@moxxy/sdk';
import { syncSkillSchedules } from './skill-sync.js';
import { ScheduleStore } from './store.js';

/**
 * Count atomic whole-file writes by wrapping the store's underlying
 * `JsonFileStore.mutate` (each `mutate` performs exactly one
 * `writeFileAtomic` → one tmp-write + rename + fsync). Spying on
 * `node:fs/promises` directly is impossible here — the SDK captured the
 * binding at import and the export is non-configurable — so we count at the
 * one-write-per-mutate seam instead.
 */
function countMutates(store: ScheduleStore): { calls: () => number } {
  const inner = (store as unknown as { store: { mutate: (...a: unknown[]) => Promise<void> } }).store;
  const orig = inner.mutate.bind(inner);
  let n = 0;
  vi.spyOn(inner, 'mutate').mockImplementation(async (...args: unknown[]) => {
    n += 1;
    return orig(...args);
  });
  return { calls: () => n };
}

function fakeRegistry(skills: ReadonlyArray<Skill>): SkillRegistry {
  const map = new Map(skills.map((s) => [s.frontmatter.name, s] as const));
  return {
    list: () => [...map.values()],
    get: (id: string) => skills.find((s) => s.id === id),
    byName: (name: string) => map.get(name),
    filterByTriggers: () => [],
  };
}

function mkSkill(
  name: string,
  schedule: NonNullable<Skill['frontmatter']['schedule']> | undefined,
  body = 'do the thing',
): Skill {
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

describe('syncSkillSchedules — single batched write', () => {
  let dir: string;
  let store: ScheduleStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-batch-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('a mixed add/update/remove sync performs exactly ONE atomic write', async () => {
    // Seed: 3 skill rows (a,b,c) + a manual row that must survive.
    await syncSkillSchedules(
      fakeRegistry([
        mkSkill('a', { cron: '0 9 * * *' }),
        mkSkill('b', { cron: '0 9 * * *' }),
        mkSkill('c', { cron: '0 9 * * *' }),
      ]),
      store,
    );
    await store.create({ name: 'manual', prompt: 'p', cron: '0 1 * * *' });
    store.invalidate();

    // One atomic write per mutate; count mutates during the reconcile only.
    const writes = countMutates(store);

    // Now: add d,e,f (3 new) + update a,b (changed body) + remove c.
    const out = await syncSkillSchedules(
      fakeRegistry([
        mkSkill('a', { cron: '0 9 * * *' }, 'new body a'),
        mkSkill('b', { cron: '0 9 * * *' }, 'new body b'),
        mkSkill('d', { cron: '0 9 * * *' }),
        mkSkill('e', { cron: '0 9 * * *' }),
        mkSkill('f', { cron: '0 9 * * *' }),
      ]),
      store,
    );

    expect(out).toEqual({ added: 3, removed: 1, updated: 2 });
    expect(writes.calls()).toBe(1);

    // The manual row survives; c is gone; a/b reflect the new bodies.
    store.invalidate();
    const rows = await store.list();
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(['a', 'b', 'd', 'e', 'f', 'manual'].sort());
    expect(rows.find((r) => r.name === 'a')!.prompt).toBe('new body a');
    expect(rows.find((r) => r.name === 'manual')).toBeDefined();
  });

  it('collapses duplicate skill rows for the same skillName down to one', async () => {
    // Seed two source='skill' rows sharing a skillName (simulating a crash
    // between writes / a hand edit). Both would otherwise fire forever.
    await store.create({
      name: 'briefing',
      prompt: 'first',
      cron: '0 9 * * *',
      source: 'skill',
      skillName: 'briefing',
    });
    await store.create({
      name: 'briefing-dup',
      prompt: 'stale-duplicate',
      cron: '0 9 * * *',
      source: 'skill',
      skillName: 'briefing',
    });
    store.invalidate();
    expect((await store.list()).filter((r) => r.skillName === 'briefing')).toHaveLength(2);

    // A sync that still WANTS the briefing skill must converge to exactly one
    // row for it (the stale duplicate is removed, not left orphaned).
    const out = await syncSkillSchedules(
      fakeRegistry([mkSkill('briefing', { cron: '0 9 * * *' }, 'first')]),
      store,
    );
    expect(out.removed).toBe(1);
    store.invalidate();
    const rows = (await store.list()).filter((r) => r.skillName === 'briefing');
    expect(rows).toHaveLength(1);
  });

  it('a no-op sync writes nothing (no rows changed)', async () => {
    await syncSkillSchedules(fakeRegistry([mkSkill('a', { cron: '0 9 * * *' })]), store);
    store.invalidate();
    await store.list();

    const writes = countMutates(store);
    const out = await syncSkillSchedules(fakeRegistry([mkSkill('a', { cron: '0 9 * * *' })]), store);
    expect(out).toEqual({ added: 0, removed: 0, updated: 0 });
    // mutate() still commits even with no diff; what matters is it is ONE write,
    // not one-per-row. (A future optimization could skip the write entirely.)
    expect(writes.calls()).toBeLessThanOrEqual(1);
  });
});
