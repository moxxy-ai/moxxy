import { describe, expect, it } from 'vitest';
import { commandsPlugin } from './index.js';
import type { CommandDef, EmittedEvent, MoxxyEvent } from '@moxxy/sdk';

const fakeSession = {
  id: 'sess-1',
  cwd: '/tmp',
  providers: { getActiveName: () => 'anthropic' },
  modes: { getActive: () => ({ name: 'default' }) },
  tools: { list: () => [{}, {}, {}] },
  skills: { list: () => [{}] },
  agents: { list: () => [{ name: 'researcher', description: 'web' }] },
  commands: { list: () => commandsPlugin.commands ?? [] },
  pluginHost: { list: () => [{}] },
};

function callCommand(name: string, channel = 'tui'): ReturnType<CommandDef['handler']> {
  const cmd = (commandsPlugin.commands ?? []).find((c) => c.name === name);
  if (!cmd) throw new Error(`missing command: ${name}`);
  return cmd.handler({
    channel,
    sessionId: 'sess-1' as never,
    args: '',
    session: fakeSession,
  });
}

describe('@moxxy/plugin-commands', () => {
  it('registers the universal command set', () => {
    const names = (commandsPlugin.commands ?? []).map((c) => c.name).sort();
    expect(names).toEqual(['clear', 'compact', 'exit', 'help', 'info', 'new']);
  });

  it('/info returns a text block with session header fields', async () => {
    const out = await callCommand('info');
    expect(out.kind).toBe('text');
    if (out.kind === 'text') {
      expect(out.text).toContain('provider:');
      expect(out.text).toContain('mode:');
      expect(out.text).toContain('agents:');
    }
  });

  // Worst-case: a registry getter throws (plugin host mid-reload, a
  // partially-constructed RemoteSession over the WS bridge). The handler must
  // still return a {kind:'text'} block — never throw — so an un-try/catch'd
  // channel (e.g. the mobile host's runCommand dispatcher) can't crash.
  it('/info degrades to "?" instead of throwing when a registry getter throws', async () => {
    const boom = () => {
      throw new Error('registry mid-reload');
    };
    const brokenSession = {
      id: 'sess-x',
      cwd: '/tmp',
      providers: { getActiveName: boom },
      modes: { getActive: boom },
      tools: { list: boom },
      skills: { list: boom },
      agents: { list: boom },
      commands: { list: boom },
      pluginHost: { list: boom },
    };
    const info = (commandsPlugin.commands ?? []).find((c) => c.name === 'info');
    if (!info) throw new Error('missing command: info');
    const out = await info.handler({
      channel: 'tui',
      sessionId: 'sess-x' as never,
      args: '',
      session: brokenSession,
    });
    expect(out.kind).toBe('text');
    if (out.kind === 'text') {
      expect(out.text).toContain('provider:  (none)');
      expect(out.text).toContain('tools:     ?');
      expect(out.text).toContain('plugins:   ?');
      expect(out.text).toContain('commands:  ?');
    }
  });

  // Worst-case: even the plain id/cwd reads must not crash /info when the
  // session is a foreign/malformed object (e.g. over the WS bridge) whose
  // property accessors are throwing getters.
  it('/info degrades id/cwd to "?" when those getters throw', async () => {
    const hostileSession = {
      get id(): never {
        throw new Error('id getter exploded');
      },
      get cwd(): never {
        throw new Error('cwd getter exploded');
      },
      providers: { getActiveName: () => 'anthropic' },
      modes: { getActive: () => ({ name: 'default' }) },
      tools: { list: () => [] },
      skills: { list: () => [] },
      agents: { list: () => [] },
      commands: { list: () => [] },
      pluginHost: { list: () => [] },
    };
    const info = (commandsPlugin.commands ?? []).find((c) => c.name === 'info');
    if (!info) throw new Error('missing command: info');
    const out = await info.handler({
      channel: 'tui',
      sessionId: 'sess-x' as never,
      args: '',
      session: hostileSession,
    });
    expect(out.kind).toBe('text');
    if (out.kind === 'text') {
      expect(out.text).toContain('session:   ?');
      expect(out.text).toContain('cwd:       ?');
    }
  });

  it('/clear and /new return session-action variants', async () => {
    const clear = await callCommand('clear');
    expect(clear.kind).toBe('session-action');
    if (clear.kind === 'session-action') expect(clear.action).toBe('clear');
    const fresh = await callCommand('new');
    expect(fresh.kind).toBe('session-action');
    if (fresh.kind === 'session-action') expect(fresh.action).toBe('new');
  });

  it('/exit aliases /quit /q', () => {
    const exit = (commandsPlugin.commands ?? []).find((c) => c.name === 'exit');
    expect(exit?.aliases).toEqual(['quit', 'q']);
  });

  it('/help filters by channel scope', async () => {
    const out = await callCommand('help', 'telegram');
    expect(out.kind).toBe('text');
    if (out.kind === 'text') {
      expect(out.text).toContain('/compact');
      expect(out.text).toContain('/info');
      expect(out.text).toContain('/help');
    }
  });

  // Worst-case: /help reads s.commands.list() (like /info). If that registry
  // throws (plugin host mid-reload, a RemoteSession over the WS bridge) the
  // handler must degrade — never throw an un-try/catch'd channel down.
  it('/help degrades to "(no commands registered)" when the registry throws', async () => {
    const help = (commandsPlugin.commands ?? []).find((c) => c.name === 'help');
    if (!help) throw new Error('missing command: help');
    const out = await help.handler({
      channel: 'tui',
      sessionId: 'sess-x' as never,
      args: '',
      session: {
        ...fakeSession,
        commands: {
          list: () => {
            throw new Error('registry mid-reload');
          },
        },
      },
    });
    expect(out).toEqual({ kind: 'text', text: '(no commands registered)' });
  });

  // A registry that returns a non-array (malformed/foreign session) must
  // collapse to empty rather than crash on .filter/.sort.
  it('/help degrades when the registry returns a non-array', async () => {
    const help = (commandsPlugin.commands ?? []).find((c) => c.name === 'help');
    if (!help) throw new Error('missing command: help');
    const out = await help.handler({
      channel: 'tui',
      sessionId: 'sess-x' as never,
      args: '',
      session: { ...fakeSession, commands: { list: () => 'not-an-array' as never } },
    });
    expect(out).toEqual({ kind: 'text', text: '(no commands registered)' });
  });

  // A buggy channel passing a non-string `args` must not crash /help on
  // `.trim()` — it degrades to the full list rather than throwing.
  it('/help tolerates a non-string args (lists all instead of crashing)', async () => {
    const help = (commandsPlugin.commands ?? []).find((c) => c.name === 'help');
    if (!help) throw new Error('missing command: help');
    const out = await help.handler({
      channel: 'tui',
      sessionId: 'sess-1' as never,
      args: undefined as never,
      session: fakeSession,
    });
    expect(out.kind).toBe('text');
    if (out.kind === 'text') {
      expect(out.text).toContain('/info');
      expect(out.text).toContain('/compact');
    }
  });

  it('/compact runs the active compactor and appends its compaction event', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'old' },
      { type: 'assistant_message', seq: 1, sessionId: 'sess-1', turnId: 'turn-1', source: 'model', content: 'answer', stopReason: 'end_turn' },
      { type: 'user_prompt', seq: 2, sessionId: 'sess-1', turnId: 'turn-2', source: 'user', text: 'now' },
    ] as unknown as MoxxyEvent[];
    const appended: EmittedEvent[] = [];
    const session = {
      ...fakeSession,
      signal: new AbortController().signal,
      log: {
        length: existing.length,
        slice: () => existing,
        asReader: () => ({
          length: existing.length,
          at: (seq: number) => existing[seq],
          slice: () => existing,
          ofType: () => [],
          byTurn: () => [],
          toJSON: () => existing,
        }),
        append: async (event: EmittedEvent) => {
          appended.push(event);
          return event as unknown as MoxxyEvent;
        },
      },
      compactors: {
        getActive: () => ({
          name: 'fake-compact',
          shouldCompact: () => false,
          compact: async (events: ReadonlyArray<MoxxyEvent>) => {
            expect(events).toBe(existing);
            return {
              type: 'compaction',
              sessionId: 'sess-1',
              turnId: 'turn-2',
              source: 'compactor',
              compactor: 'fake-compact',
              replacedRange: [0, 2],
              summary: 'old conversation summary',
              tokensSaved: 315_810,
            } as const;
          },
        }),
      },
    };

    const compact = (commandsPlugin.commands ?? []).find((c) => c.name === 'compact');
    if (!compact) throw new Error('missing command: compact');
    const out = await compact.handler({
      channel: 'tui',
      sessionId: 'sess-1' as never,
      args: '',
      session,
    });

    expect(out).toEqual({
      kind: 'text',
      text: 'context compacted: 3 events, ~315.8k tokens saved',
    });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      type: 'compaction',
      compactor: 'fake-compact',
      summary: 'old conversation summary',
      tokensSaved: 315_810,
    });
  });

  // Regression for u80-4: the reported count must be the ACTUAL number of
  // events inside the replaced seq range, not the seq SPAN — `seq` is not a
  // dense array index for mirrors/partial views, so a gap inside the range
  // would otherwise overstate the count.
  it('/compact counts events in the replaced range, not the seq span (sparse seqs)', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'a' },
      { type: 'assistant_message', seq: 1, sessionId: 'sess-1', turnId: 'turn-1', source: 'model', content: 'b', stopReason: 'end_turn' },
      // seqs 2,3,4 are absent (e.g. a partial/mirrored view) — a gap.
      { type: 'user_prompt', seq: 5, sessionId: 'sess-1', turnId: 'turn-2', source: 'user', text: 'c' },
    ] as unknown as MoxxyEvent[];
    const session = {
      ...fakeSession,
      signal: new AbortController().signal,
      log: {
        length: existing.length,
        slice: () => existing,
        append: async (event: EmittedEvent) => event as unknown as MoxxyEvent,
      },
      compactors: {
        getActive: () => ({
          name: 'fake-compact',
          shouldCompact: () => false,
          compact: async () =>
            ({
              type: 'compaction',
              sessionId: 'sess-1',
              turnId: 'turn-2',
              source: 'compactor',
              compactor: 'fake-compact',
              replacedRange: [0, 5], // span = 6, but only 3 events fall inside
              summary: 'summary',
              tokensSaved: 1000,
            }) as const,
        }),
      },
    };

    const compact = (commandsPlugin.commands ?? []).find((c) => c.name === 'compact');
    if (!compact) throw new Error('missing command: compact');
    const out = await compact.handler({
      channel: 'tui',
      sessionId: 'sess-1' as never,
      args: '',
      session,
    });
    // 3 actual events, NOT 6 (the seq span 5-0+1).
    expect(out).toMatchObject({ kind: 'text', text: expect.stringContaining('3 events') });
  });

  it('/compact exposes a pending notice for interactive channels', () => {
    const compact = (commandsPlugin.commands ?? []).find((c) => c.name === 'compact');
    expect(compact).toMatchObject({ pendingNotice: 'compacting context...' });
  });

  // Regression for u80-1: /compact must forward the active provider+model so
  // the default summarize compactor can write a real summary instead of
  // falling back to a lossy truncation.
  it('/compact forwards the active provider and model to compact()', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'old' },
    ] as unknown as MoxxyEvent[];
    const fakeProvider = { name: 'anthropic', models: [{ id: 'claude-x', contextWindow: 200_000 }] };
    let seenCtx: { provider?: unknown; model?: unknown } | undefined;
    const session = {
      ...fakeSession,
      signal: new AbortController().signal,
      providers: { getActiveName: () => 'anthropic', getActive: () => fakeProvider },
      log: {
        length: existing.length,
        slice: () => existing,
        append: async (event: EmittedEvent) => event as unknown as MoxxyEvent,
      },
      compactors: {
        getActive: () => ({
          name: 'fake-compact',
          shouldCompact: () => false,
          compact: async (_events: ReadonlyArray<MoxxyEvent>, ctx: { provider?: unknown; model?: unknown }) => {
            seenCtx = ctx;
            return {
              type: 'compaction',
              compactor: 'fake-compact',
              replacedRange: [0, 0],
              summary: 'real summary',
              tokensSaved: 100,
            } as const;
          },
        }),
      },
    };

    const compact = (commandsPlugin.commands ?? []).find((c) => c.name === 'compact');
    if (!compact) throw new Error('missing command: compact');
    await compact.handler({ channel: 'tui', sessionId: 'sess-1' as never, args: '', session });

    expect(seenCtx?.provider).toBe(fakeProvider);
    expect(seenCtx?.model).toBe('claude-x');
  });

  // u80-2: compactSession now delegates to the shared SDK runManualCompaction
  // helper. The active model's real contextWindow must reach the budget the
  // helper builds (it used to be resolved by the plugin's own duplicate
  // resolveActiveContextWindow); a no-op formats "nothing to compact yet".
  it('/compact forwards the active model contextWindow into the budget', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'old' },
    ] as unknown as MoxxyEvent[];
    const fakeProvider = { name: 'anthropic', models: [{ id: 'claude-x', contextWindow: 123_456 }] };
    let seenBudget: { contextWindow?: number } | undefined;
    const session = {
      ...fakeSession,
      signal: new AbortController().signal,
      providers: { getActiveName: () => 'anthropic', getActive: () => fakeProvider },
      log: {
        length: existing.length,
        slice: () => existing,
        append: async (event: EmittedEvent) => event as unknown as MoxxyEvent,
      },
      compactors: {
        getActive: () => ({
          name: 'fake-compact',
          shouldCompact: () => false,
          compact: async (_events: ReadonlyArray<MoxxyEvent>, ctx: { budget?: { contextWindow?: number } }) => {
            seenBudget = ctx.budget;
            return {
              type: 'compaction',
              compactor: 'fake-compact',
              replacedRange: [0, 0],
              summary: 's',
              tokensSaved: 10,
            } as const;
          },
        }),
      },
    };

    const compact = (commandsPlugin.commands ?? []).find((c) => c.name === 'compact');
    if (!compact) throw new Error('missing command: compact');
    await compact.handler({ channel: 'tui', sessionId: 'sess-1' as never, args: '', session });

    expect(seenBudget?.contextWindow).toBe(123_456);
  });

  // Regression for u80-3: a spec-compliant compactor may return ONLY the
  // Omit<CompactionEvent, keyof EventBase> fields. The appended event must
  // still carry sessionId/turnId/source so replay/projection accepts it.
  it('/compact defensively fills sessionId/turnId/source on the emitted event', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-7', source: 'user', text: 'old' },
      { type: 'user_prompt', seq: 1, sessionId: 'sess-1', turnId: 'turn-7', source: 'user', text: 'now' },
    ] as unknown as MoxxyEvent[];
    const appended: EmittedEvent[] = [];
    const session = {
      ...fakeSession,
      signal: new AbortController().signal,
      log: {
        length: existing.length,
        slice: () => existing,
        append: async (event: EmittedEvent) => {
          appended.push(event);
          return event as unknown as MoxxyEvent;
        },
      },
      compactors: {
        getActive: () => ({
          name: 'spec-compact',
          shouldCompact: () => false,
          // Returns only the type-contract fields — no sessionId/turnId/source.
          compact: async () =>
            ({
              type: 'compaction',
              compactor: 'spec-compact',
              replacedRange: [0, 1],
              summary: 'summary',
              tokensSaved: 50,
            }) as never,
        }),
      },
    };

    const compact = (commandsPlugin.commands ?? []).find((c) => c.name === 'compact');
    if (!compact) throw new Error('missing command: compact');
    await compact.handler({ channel: 'tui', sessionId: 'sess-1' as never, args: '', session });

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      type: 'compaction',
      sessionId: 'sess-1',
      turnId: 'turn-7',
      source: 'compactor',
    });
  });

  // u80-6: the early-return / error branches of compactSession.
  const runCompact = (session: unknown) => {
    const compact = (commandsPlugin.commands ?? []).find((c) => c.name === 'compact');
    if (!compact) throw new Error('missing command: compact');
    return compact.handler({ channel: 'tui', sessionId: 'sess-1' as never, args: '', session });
  };

  it('/compact errors when there is no active compactor', async () => {
    const out = await runCompact({ ...fakeSession, compactors: { getActive: () => null } });
    expect(out).toEqual({ kind: 'error', message: 'no active compactor configured' });
  });

  it('/compact reports an empty event log', async () => {
    const out = await runCompact({
      ...fakeSession,
      compactors: { getActive: () => ({ name: 'c', shouldCompact: () => false, compact: async () => ({}) }) },
      log: { length: 0, slice: () => [], append: async () => undefined },
    });
    expect(out).toEqual({ kind: 'text', text: 'nothing to compact: event log is empty' });
  });

  it('/compact surfaces a compactor throw as kind:error', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'x' },
    ] as unknown as MoxxyEvent[];
    const out = await runCompact({
      ...fakeSession,
      signal: new AbortController().signal,
      log: { length: existing.length, slice: () => existing, append: async () => undefined },
      compactors: {
        getActive: () => ({
          name: 'c',
          shouldCompact: () => false,
          compact: async () => {
            throw new Error('compactor exploded');
          },
        }),
      },
    });
    expect(out).toEqual({ kind: 'error', message: 'compactor exploded' });
  });

  it('/compact reports "nothing to compact yet" when tokensSaved <= 0', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'x' },
    ] as unknown as MoxxyEvent[];
    const out = await runCompact({
      ...fakeSession,
      signal: new AbortController().signal,
      log: { length: existing.length, slice: () => existing, append: async () => undefined },
      compactors: {
        getActive: () => ({
          name: 'c',
          shouldCompact: () => false,
          compact: async () =>
            ({ type: 'compaction', compactor: 'c', replacedRange: [0, 0], summary: 'noop', tokensSaved: 0 }) as const,
        }),
      },
    });
    expect(out).toEqual({ kind: 'text', text: 'nothing to compact yet' });
  });

  it('/compact reports "nothing to compact yet" when the summary is blank', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'x' },
    ] as unknown as MoxxyEvent[];
    const out = await runCompact({
      ...fakeSession,
      signal: new AbortController().signal,
      log: { length: existing.length, slice: () => existing, append: async () => undefined },
      compactors: {
        getActive: () => ({
          name: 'c',
          shouldCompact: () => false,
          compact: async () =>
            ({ type: 'compaction', compactor: 'c', replacedRange: [0, 0], summary: '   ', tokensSaved: 999 }) as const,
        }),
      },
    });
    expect(out).toEqual({ kind: 'text', text: 'nothing to compact yet' });
  });

  it('/compact formats a >=1M token-savings count with the M suffix', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'x' },
    ] as unknown as MoxxyEvent[];
    const out = await runCompact({
      ...fakeSession,
      signal: new AbortController().signal,
      log: { length: existing.length, slice: () => existing, append: async () => undefined },
      compactors: {
        getActive: () => ({
          name: 'c',
          shouldCompact: () => false,
          compact: async () =>
            ({ type: 'compaction', compactor: 'c', replacedRange: [0, 0], summary: 's', tokensSaved: 2_000_000 }) as const,
        }),
      },
    });
    expect(out.kind).toBe('text');
    if (out.kind === 'text') expect(out.text).toContain('~2M tokens saved');
  });

  // Worst-case: a malformed/foreign provider (e.g. passed over the WS bridge)
  // whose `.models` is a throwing getter must NOT crash /compact — model/window
  // resolution is guarded, so the compactor still runs with the fallback window.
  it('/compact survives a provider whose .models getter throws', async () => {
    const existing = [
      { type: 'user_prompt', seq: 0, sessionId: 'sess-1', turnId: 'turn-1', source: 'user', text: 'x' },
    ] as unknown as MoxxyEvent[];
    let compacted = false;
    const hostileProvider = {
      name: 'evil',
      get models(): never {
        throw new Error('models getter exploded');
      },
    };
    const out = await runCompact({
      ...fakeSession,
      signal: new AbortController().signal,
      providers: { getActiveName: () => 'evil', getActive: () => hostileProvider },
      log: { length: existing.length, slice: () => existing, append: async () => undefined },
      compactors: {
        getActive: () => ({
          name: 'c',
          shouldCompact: () => false,
          compact: async () => {
            compacted = true;
            return {
              type: 'compaction',
              compactor: 'c',
              replacedRange: [0, 0],
              summary: 's',
              tokensSaved: 42,
            } as const;
          },
        }),
      },
    });
    expect(compacted).toBe(true);
    expect(out.kind).toBe('text');
    if (out.kind === 'text') expect(out.text).toContain('42 tokens saved');
  });

  it('/help <command> shows a single command detail with usage and aliases', async () => {
    const compact = (commandsPlugin.commands ?? []).find((c) => c.name === 'help');
    if (!compact) throw new Error('missing command: help');
    const out = await compact.handler({
      channel: 'tui',
      sessionId: 'sess-1' as never,
      args: 'exit',
      session: fakeSession,
    });
    expect(out.kind).toBe('text');
    if (out.kind === 'text') {
      expect(out.text).toContain('/exit');
      expect(out.text).toContain('aliases:');
      expect(out.text).toContain('/quit');
    }
  });

  it('/help <unknown> reports no such command', async () => {
    const help = (commandsPlugin.commands ?? []).find((c) => c.name === 'help');
    if (!help) throw new Error('missing command: help');
    const out = await help.handler({
      channel: 'tui',
      sessionId: 'sess-1' as never,
      args: 'nope',
      session: fakeSession,
    });
    expect(out).toEqual({ kind: 'text', text: 'no command named "/nope" (try /help)' });
  });
});
