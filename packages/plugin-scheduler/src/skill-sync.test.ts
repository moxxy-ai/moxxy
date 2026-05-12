import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Skill, SkillRegistry } from '@moxxy/sdk';
import { asSkillId } from '@moxxy/sdk';
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

describe('syncSkillSchedules', () => {
  let dir: string;
  let store: ScheduleStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-skills-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a schedule for a skill with a schedule block', async () => {
    const reg = fakeRegistry([mkSkill('briefing', { cron: '0 9 * * *', channel: 'telegram' })]);
    const out = await syncSkillSchedules(reg, store);
    expect(out.added).toBe(1);
    const stored = await store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.source).toBe('skill');
    expect(stored[0]!.skillName).toBe('briefing');
    expect(stored[0]!.channel).toBe('telegram');
  });

  it('skips skills without a schedule block', async () => {
    const reg = fakeRegistry([mkSkill('chat-helper', undefined)]);
    const out = await syncSkillSchedules(reg, store);
    expect(out.added).toBe(0);
    expect(await store.list()).toEqual([]);
  });

  it('removes schedules when a skill drops its schedule block', async () => {
    // First sync: skill has schedule.
    let reg = fakeRegistry([mkSkill('briefing', { cron: '0 9 * * *' })]);
    await syncSkillSchedules(reg, store);
    expect((await store.list()).length).toBe(1);

    // Skill loses schedule block.
    reg = fakeRegistry([mkSkill('briefing', undefined)]);
    const out = await syncSkillSchedules(reg, store);
    expect(out.removed).toBe(1);
    expect(await store.list()).toEqual([]);
  });

  it('leaves manual schedules alone', async () => {
    await store.create({ name: 'manual', prompt: 'p', cron: '0 9 * * *' });
    const reg = fakeRegistry([mkSkill('briefing', { cron: '0 10 * * *' })]);
    await syncSkillSchedules(reg, store);
    const stored = await store.list();
    expect(stored).toHaveLength(2);
    expect(stored.find((s) => s.source === 'manual')).toBeDefined();
    expect(stored.find((s) => s.source === 'skill')).toBeDefined();
  });

  it('updates an existing skill schedule when frontmatter changes', async () => {
    let reg = fakeRegistry([mkSkill('briefing', { cron: '0 9 * * *' }, 'first body')]);
    await syncSkillSchedules(reg, store);

    reg = fakeRegistry([mkSkill('briefing', { cron: '0 18 * * *' }, 'second body')]);
    const out = await syncSkillSchedules(reg, store);
    expect(out.updated).toBe(1);
    const stored = await store.list();
    expect(stored[0]!.cron).toBe('0 18 * * *');
    expect(stored[0]!.prompt).toBe('second body');
  });

  it('refuses invalid cron expressions silently', async () => {
    const reg = fakeRegistry([mkSkill('broken', { cron: 'totally not a cron' })]);
    const out = await syncSkillSchedules(reg, store);
    expect(out.added).toBe(0);
  });
});
