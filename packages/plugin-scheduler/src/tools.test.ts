import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolContext, ToolDef } from '@moxxy/sdk';
import { assertDefined, zodToJsonSchema } from '@moxxy/sdk';
import { ScheduleStore } from './store.js';
import { buildSchedulerTools } from './tools.js';

const ctx = {} as ToolContext;

describe('schedule_create tool — input validation hardening', () => {
  let dir: string;
  let store: ScheduleStore;
  let create: ToolDef;

  const executeCreate = async (input: unknown): Promise<Record<string, unknown>> => {
    const parsed = create.inputSchema.safeParse(input);
    if (!parsed.success) throw parsed.error;
    return (await create.handler(parsed.data, ctx)) as Record<string, unknown>;
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'moxxy-sched-tools-'));
    store = new ScheduleStore({ file: path.join(dir, 'schedules.json') });
    const tools = buildSchedulerTools({
      store,
      runner: { runPrompt: async () => ({ text: 'ok' }) },
      ownerSessionId: 'creator-session',
    });
    const found = tools.find((t) => t.name === 'schedule_create');
    assertDefined(found, 'schedule_create tool is registered');
    create = found;
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

  it('creates a recurring schedule from the blank placeholders emitted by openai-codex', async () => {
    const out = await executeCreate({
      name: 'daily-summary',
      prompt: 'Prepare the daily summary',
      channel: 'inbox',
      model: 'gpt-5.5',
      targetSessionId: '',
      cron: '0 10 * * *',
      runAt: '',
      timeZone: 'Europe/Warsaw',
    });

    expect(out).toMatchObject({
      cron: '0 10 * * *',
      runAt: null,
      targetSessionId: 'creator-session',
    });
    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      cron: '0 10 * * *',
      ownerSessionId: 'creator-session',
      channel: 'inbox',
      model: 'gpt-5.5',
      timeZone: 'Europe/Warsaw',
    });
    expect(entries[0]?.runAt).toBeUndefined();
  });

  it('creates a one-shot schedule while dropping whitespace-only optional placeholders', async () => {
    const runAt = '2030-08-01T10:00:00.000Z';
    const out = await executeCreate({
      name: 'one-shot',
      prompt: 'Run once',
      channel: '   ',
      model: '',
      targetSessionId: '  ',
      cron: '\t',
      runAt,
      timeZone: ' ',
    });

    expect(out).toMatchObject({
      cron: null,
      runAt: Date.parse(runAt),
      targetSessionId: 'creator-session',
      channel: null,
      model: null,
      timeZone: null,
    });
    const entries = await store.list();
    expect(entries[0]?.cron).toBeUndefined();
    expect(entries[0]?.runAt).toBe(Date.parse(runAt));
    expect(entries[0]?.ownerSessionId).toBe('creator-session');
  });

  it('rejects blank-only triggers after normalization', () => {
    const r = create.inputSchema.safeParse({
      name: 'blank-triggers',
      prompt: 'x',
      cron: ' ',
      runAt: '\t',
    });
    expect(r.success).toBe(false);
  });

  it('does not treat epoch zero as an empty runAt placeholder', () => {
    const r = create.inputSchema.safeParse({
      name: 'real-zero',
      prompt: 'x',
      cron: '0 9 * * *',
      runAt: 0,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-empty invalid timestamp', () => {
    const r = create.inputSchema.safeParse({
      name: 'invalid-time',
      prompt: 'x',
      runAt: 'not-a-timestamp',
    });
    expect(r.success).toBe(false);
  });

  it('keeps only name and prompt required in the provider JSON schema', () => {
    const schema = zodToJsonSchema(create.inputSchema) as { required?: ReadonlyArray<string> };
    expect(schema.required).toEqual(['name', 'prompt']);
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
  const handler = (list: ReadonlyArray<ToolDef>, name: string): ToolDef['handler'] => {
    const tool = list.find((t) => t.name === name);
    assertDefined(tool, `tool "${name}" is registered`);
    return tool.handler;
  };

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
