import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolContext, ToolDef } from '@moxxy/sdk';
import { ScheduleStore } from './store.js';
import { buildSchedulerTools } from './tools.js';

const ctx = {} as ToolContext;

describe('schedule_create tool — input validation hardening', () => {
  let dir: string;
  let store: ScheduleStore;
  let create: ToolDef;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-tools-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
    const tools = buildSchedulerTools({
      store,
      runner: { runPrompt: async () => ({ text: 'ok' }) },
    });
    create = tools.find((t) => t.name === 'schedule_create')!;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('schema rejects supplying BOTH cron and runAt', () => {
    const r = create.inputSchema.safeParse({
      name: 'both',
      prompt: 'x',
      cron: '0 9 * * *',
      runAt: Date.now() + 1000,
    });
    expect(r.success).toBe(false);
  });

  it('schema rejects supplying neither cron nor runAt', () => {
    const r = create.inputSchema.safeParse({ name: 'neither', prompt: 'x' });
    expect(r.success).toBe(false);
  });

  it('handler rejects a non-IANA timeZone (would otherwise crash a tick)', async () => {
    await expect(
      create.handler(
        { name: 'badtz', prompt: 'x', cron: '0 9 * * *', timeZone: 'Mars/Phobos' },
        ctx,
      ),
    ).rejects.toThrow(/timeZone/);
    // The bad-zone schedule must NOT have been persisted.
    expect(await store.list()).toEqual([]);
  });

  it('handler accepts a valid cron + real IANA timeZone', async () => {
    const out = (await create.handler(
      { name: 'good', prompt: 'x', cron: '0 9 * * *', timeZone: 'America/New_York' },
      ctx,
    )) as { timeZone: string | null };
    expect(out.timeZone).toBe('America/New_York');
    expect((await store.list())).toHaveLength(1);
  });
});

describe('schedule target session (ownerSessionId routing)', () => {
  let dir: string;
  let store: ScheduleStore;

  const tools = (ownerSessionId?: string): ReadonlyArray<ToolDef> =>
    buildSchedulerTools({
      store,
      runner: { runPrompt: async () => ({ text: 'ok' }) },
      ...(ownerSessionId ? { ownerSessionId } : {}),
    });
  const handler = (list: ReadonlyArray<ToolDef>, name: string): ToolDef['handler'] =>
    list.find((t) => t.name === name)!.handler;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-target-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stamps ownerSessionId from an explicit targetSessionId, overriding the creator', async () => {
    const out = (await handler(tools('creator'), 'schedule_create')(
      { name: 'pinned', prompt: 'x', cron: '0 9 * * *', targetSessionId: 'desk-B' },
      ctx,
    )) as { id: string };
    expect((await store.get(out.id))?.ownerSessionId).toBe('desk-B');
  });

  it('defaults to the creating runner when no targetSessionId is given', async () => {
    const out = (await handler(tools('creator'), 'schedule_create')(
      { name: 'default', prompt: 'x', cron: '0 9 * * *' },
      ctx,
    )) as { id: string };
    expect((await store.get(out.id))?.ownerSessionId).toBe('creator');
  });

  it('schedule_set_target reassigns and clears the binding', async () => {
    const list = tools('creator');
    const created = (await handler(list, 'schedule_create')(
      { name: 'movable', prompt: 'x', cron: '0 9 * * *' },
      ctx,
    )) as { id: string };
    await handler(list, 'schedule_set_target')({ id: created.id, targetSessionId: 'desk-C' }, ctx);
    expect((await store.get(created.id))?.ownerSessionId).toBe('desk-C');
    // Omitting targetSessionId clears it (revert to owner-less fire-once).
    await handler(list, 'schedule_set_target')({ id: created.id }, ctx);
    expect((await store.get(created.id))?.ownerSessionId).toBeUndefined();
  });
});
