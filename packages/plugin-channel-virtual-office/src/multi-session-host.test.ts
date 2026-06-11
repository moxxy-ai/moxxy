/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles cast loosely */
import { describe, it, expect, vi } from 'vitest';
import type { ClientSession } from '@moxxy/sdk';
import type { CommandBus, EventSink } from '@moxxy/desktop-ipc-contract/bus';
import { VirtualOfficeHost } from './multi-session-host.js';

/** A bus that records handler registrations + broadcasts and can invoke handlers. */
class FakeBus implements CommandBus, EventSink {
  readonly handlers = new Map<string, (arg: unknown) => Promise<unknown>>();
  readonly events: Array<{ channel: string; payload: unknown }> = [];
  handle(channel: string, fn: (...args: never[]) => Promise<unknown>): void {
    this.handlers.set(channel, fn as (arg: unknown) => Promise<unknown>);
  }
  broadcast(channel: string, payload: unknown): void {
    this.events.push({ channel, payload });
  }
  invoke(channel: string, arg?: unknown): Promise<unknown> {
    const fn = this.handlers.get(channel);
    if (!fn) throw new Error(`no handler for ${channel}`);
    return fn(arg);
  }
  event(channel: string): { channel: string; payload: any }[] {
    return this.events.filter((e) => e.channel === channel) as {
      channel: string;
      payload: any;
    }[];
  }
}

let sessionSeq = 0;

function fakeSession(overrides: Record<string, unknown> = {}) {
  const id = (overrides.id as string) ?? `sess-${++sessionSeq}`;
  const logSubs = new Set<(e: unknown) => void>();
  let permissionResolver: any = null;
  let approvalResolver: any = null;
  let activeMode = 'default';
  const close = vi.fn(async () => {});
  const reset = vi.fn(async () => {});
  const session = {
    id,
    cwd: '/tmp',
    permissions: { addAllow: vi.fn(async () => {}) },
    log: {
      subscribe: (fn: (e: unknown) => void) => {
        logSubs.add(fn);
        return () => logSubs.delete(fn);
      },
      clear: vi.fn(),
    },
    runTurn: vi.fn((_prompt: string, _opts?: unknown) =>
      (async function* () {
        /* empty turn — completes immediately */
      })(),
    ),
    getInfo: () => ({
      sessionId: id,
      providers: [],
      modes: [],
      activeProvider: 'noop',
      activeMode,
      activeModeBadge: null,
    }),
    modes: {
      setActive: vi.fn((name: string) => {
        activeMode = name;
      }),
    },
    commands: {
      get: (name: string) =>
        name === 'echo'
          ? {
              name: 'echo',
              description: 'echo back',
              handler: async (ctx: { args: string }) => ({ kind: 'text', text: `echo:${ctx.args}` }),
            }
          : undefined,
    },
    reset,
    close,
    setPermissionResolver: (r: unknown) => {
      permissionResolver = r;
    },
    setApprovalResolver: (r: unknown) => {
      approvalResolver = r;
    },
    ...overrides,
  };
  return {
    session: session as unknown as ClientSession,
    raw: session,
    emit: (e: unknown) => logSubs.forEach((fn) => fn(e)),
    getPermissionResolver: () => permissionResolver,
    getApprovalResolver: () => approvalResolver,
    close,
    reset,
  };
}

/** Host over a fake primary + a queue of fake spawns. */
function buildHost(spawnCount = 4) {
  const bus = new FakeBus();
  const primary = fakeSession();
  const spawns = Array.from({ length: spawnCount }, () => fakeSession());
  let next = 0;
  const disposeSpawn = vi.fn();
  const host = new VirtualOfficeHost(bus, primary.session, {
    spawnSession: () => {
      const spawned = spawns[next++];
      if (!spawned) throw new Error('spawn queue exhausted');
      return { session: spawned.session, dispose: disposeSpawn };
    },
  });
  host.register();
  host.wire();
  return { bus, primary, spawns, host, disposeSpawn };
}

describe('VirtualOfficeHost roster', () => {
  it('exposes the primary as a connected workspace and lists it as Manager', async () => {
    const { bus, primary } = buildHost();
    const snaps = (await bus.invoke('connection.snapshotAll')) as Array<{
      workspaceId: string;
      phase: { phase: string };
    }>;
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.workspaceId).toBe(primary.raw.id);
    expect(snaps[0]?.phase.phase).toBe('connected');
    const overview = (await bus.invoke('sessions.list')) as {
      sessions: Array<{ id: string; name: string }>;
      activeSessionId: string;
    };
    expect(overview.sessions[0]?.name).toBe('Manager');
    expect(overview.activeSessionId).toBe(primary.raw.id);
  });

  it('sessions.create spawns a wired worker with a default name', async () => {
    const { bus, spawns } = buildHost();
    const created = (await bus.invoke('sessions.create', {})) as { id: string; name: string };
    expect(created.id).toBe(spawns[0]!.raw.id);
    expect(created.name).toBe('Agent 2');
    // The new worker is live: its events broadcast tagged with its id.
    spawns[0]!.emit({ type: 'assistant_chunk', delta: 'hi' });
    expect(
      bus
        .event('runner.event')
        .some((e) => e.payload.workspaceId === created.id && e.payload.event.delta === 'hi'),
    ).toBe(true);
    // And its arrival was announced.
    expect(
      bus
        .event('connection.changed')
        .some((e) => e.payload.workspaceId === created.id && e.payload.phase.phase === 'connected'),
    ).toBe(true);
  });

  it('sessions.rename updates the roster; setActive rejects unknown ids', async () => {
    const { bus } = buildHost();
    const created = (await bus.invoke('sessions.create', { name: 'Scout' })) as {
      id: string;
      name: string;
    };
    expect(created.name).toBe('Scout');
    const renamed = (await bus.invoke('sessions.rename', { id: created.id, name: 'Sage' })) as {
      name: string;
    };
    expect(renamed.name).toBe('Sage');
    await bus.invoke('sessions.setActive', { id: created.id });
    expect(await bus.invoke('connection.activeWorkspace')).toBe(created.id);
    await expect(bus.invoke('sessions.setActive', { id: 'ghost' })).rejects.toMatchObject({
      code: 'no-workspace',
    });
  });

  it('refuses to remove the primary; removing a worker closes it and announces idle', async () => {
    const { bus, primary, spawns } = buildHost();
    await expect(bus.invoke('sessions.remove', { id: primary.raw.id })).rejects.toMatchObject({
      code: 'not-supported',
    });
    const created = (await bus.invoke('sessions.create', {})) as { id: string };
    await bus.invoke('sessions.setActive', { id: created.id });
    await bus.invoke('sessions.remove', { id: created.id });
    expect(spawns[0]!.close).toHaveBeenCalled();
    // Active pointer falls back to the primary.
    expect(await bus.invoke('connection.activeWorkspace')).toBe(primary.raw.id);
    expect(
      bus
        .event('connection.changed')
        .some((e) => e.payload.workspaceId === created.id && e.payload.phase.phase === 'idle'),
    ).toBe(true);
  });
});

describe('VirtualOfficeHost per-workspace routing', () => {
  it('routes runTurn/abort to the addressed worker only and tags turn.complete', async () => {
    const { bus, primary, spawns } = buildHost();
    const created = (await bus.invoke('sessions.create', {})) as { id: string };
    const { turnId } = (await bus.invoke('session.runTurn', {
      workspaceId: created.id,
      prompt: 'hi',
    })) as { turnId: string };
    expect(spawns[0]!.raw.runTurn).toHaveBeenCalled();
    expect(primary.raw.runTurn).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(
      bus
        .event('runner.turn.complete')
        .some(
          (e) =>
            e.payload.workspaceId === created.id &&
            e.payload.turnId === turnId &&
            e.payload.error === null,
        ),
    ).toBe(true);
  });

  it('defaults to the active workspace when none is addressed', async () => {
    const { bus, primary, spawns } = buildHost();
    const created = (await bus.invoke('sessions.create', {})) as { id: string };
    await bus.invoke('sessions.setActive', { id: created.id });
    await bus.invoke('session.runTurn', { prompt: 'hello' });
    expect(spawns[0]!.raw.runTurn).toHaveBeenCalled();
    expect(primary.raw.runTurn).not.toHaveBeenCalled();
  });

  it('session.newSession resets only the addressed worker', async () => {
    const { bus, primary, spawns } = buildHost();
    const created = (await bus.invoke('sessions.create', {})) as { id: string };
    await bus.invoke('session.newSession', { workspaceId: created.id });
    expect(spawns[0]!.reset).toHaveBeenCalled();
    expect(primary.reset).not.toHaveBeenCalled();
  });

  it('session.setMode switches the addressed worker and re-broadcasts its phase', async () => {
    const { bus } = buildHost();
    const created = (await bus.invoke('sessions.create', {})) as { id: string };
    await bus.invoke('session.setMode', { workspaceId: created.id, mode: 'goal' });
    expect(
      bus
        .event('connection.changed')
        .some(
          (e) => e.payload.workspaceId === created.id && e.payload.phase.activeMode === 'goal',
        ),
    ).toBe(true);
  });

  it('runs slash commands on the addressed worker under the office channel', async () => {
    const { bus } = buildHost();
    const created = (await bus.invoke('sessions.create', {})) as { id: string };
    expect(
      await bus.invoke('session.runCommand', { workspaceId: created.id, name: 'echo', args: 'x' }),
    ).toEqual({ kind: 'text', text: 'echo:x' });
    expect(await bus.invoke('session.runCommand', { name: 'nope', args: '' })).toEqual({
      kind: 'error',
      message: 'unknown command: /nope',
    });
  });
});

describe('VirtualOfficeHost asks', () => {
  it('keeps concurrent asks from different workers independent', async () => {
    const { bus, primary, spawns } = buildHost();
    await bus.invoke('sessions.create', {});
    const primaryResolver = primary.getPermissionResolver();
    const workerResolver = spawns[0]!.getPermissionResolver();
    const verdictA = primaryResolver.check({ name: 'tool_a', input: {} }, {});
    const verdictB = workerResolver.check({ name: 'tool_b', input: {} }, {});
    const asks = bus.event('ask.request');
    expect(asks).toHaveLength(2);
    const askA = asks.find((e) => e.payload.tool.name === 'tool_a')!;
    const askB = asks.find((e) => e.payload.tool.name === 'tool_b')!;
    expect(askA.payload.workspaceId).toBe(primary.raw.id);
    expect(askB.payload.workspaceId).toBe(spawns[0]!.raw.id);
    // Answer them in reverse order — each promise resolves with its own verdict.
    await bus.invoke('ask.respond', { requestId: askB.payload.requestId, response: { mode: 'deny' } });
    await bus.invoke('ask.respond', { requestId: askA.payload.requestId, response: { mode: 'allow' } });
    await expect(verdictA).resolves.toEqual({ mode: 'allow' });
    await expect(verdictB).resolves.toEqual({ mode: 'deny' });
  });

  it('allow_always persists via the worker session permissions', async () => {
    const { bus, spawns } = buildHost();
    await bus.invoke('sessions.create', {});
    const verdict = spawns[0]!.getPermissionResolver().check({ name: 'wave', input: {} }, {});
    const ask = bus.event('ask.request')[0]!;
    await bus.invoke('ask.respond', {
      requestId: ask.payload.requestId,
      response: { mode: 'allow_always' },
    });
    await expect(verdict).resolves.toEqual({ mode: 'allow_always' });
    expect((spawns[0]!.raw.permissions as any).addAllow).toHaveBeenCalledWith({ name: 'wave' });
  });

  it('auto-approve short-circuits the prompt for that worker only', async () => {
    const { bus, primary, spawns } = buildHost();
    const created = (await bus.invoke('sessions.create', {})) as { id: string };
    await bus.invoke('session.setAutoApprove', { workspaceId: created.id, enabled: true });
    await expect(
      spawns[0]!.getPermissionResolver().check({ name: 'wave', input: {} }, {}),
    ).resolves.toEqual({ mode: 'allow' });
    // The primary still prompts.
    const verdict = primary.getPermissionResolver().check({ name: 'wave', input: {} }, {});
    expect(bus.event('ask.request')).toHaveLength(1);
    await bus.invoke('ask.respond', {
      requestId: bus.event('ask.request')[0]!.payload.requestId,
      response: { mode: 'deny' },
    });
    await expect(verdict).resolves.toEqual({ mode: 'deny' });
  });

  it('removing a worker denies its parked asks', async () => {
    const { bus, spawns } = buildHost();
    const created = (await bus.invoke('sessions.create', {})) as { id: string };
    const verdict = spawns[0]!.getPermissionResolver().check({ name: 'wave', input: {} }, {});
    await bus.invoke('sessions.remove', { id: created.id });
    await expect(verdict).resolves.toEqual({ mode: 'deny' });
  });
});

describe('VirtualOfficeHost dispose', () => {
  it('denies parked asks, closes owned sessions, and leaves the primary open', async () => {
    const { bus, primary, spawns, host, disposeSpawn } = buildHost();
    await bus.invoke('sessions.create', {});
    const verdict = primary.getPermissionResolver().check({ name: 'wave', input: {} }, {});
    await host.dispose();
    await expect(verdict).resolves.toEqual({ mode: 'deny' });
    expect(spawns[0]!.close).toHaveBeenCalled();
    expect(primary.close).not.toHaveBeenCalled();
    expect(disposeSpawn).toHaveBeenCalled();
  });
});
