/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles cast loosely */
import { describe, it, expect, vi } from 'vitest';
import type { ClientSession } from '@moxxy/sdk';
import type { CommandBus, EventSink } from '@moxxy/desktop-ipc-contract/bus';
import { MobileSessionHost } from './single-session-host.js';

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
    return this.events.filter((e) => e.channel === channel) as { channel: string; payload: any }[];
  }
}

function fakeSession(overrides: Record<string, unknown> = {}) {
  const logSubs = new Set<(e: unknown) => void>();
  let permissionResolver: any = null;
  let approvalResolver: any = null;
  let activeMode = 'default';
  const session = {
    id: 'sess-1',
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
      sessionId: 'sess-1',
      providers: [],
      modes: [],
      activeProvider: 'openai',
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
  };
}

describe('MobileSessionHost', () => {
  it('snapshotAll reports a single connected workspace keyed by session id', async () => {
    const bus = new FakeBus();
    const { session } = fakeSession();
    const host = new MobileSessionHost(bus, session);
    host.register();
    const snaps = (await bus.invoke('connection.snapshotAll')) as Array<{
      workspaceId: string;
      phase: { phase: string };
    }>;
    expect(snaps[0]?.workspaceId).toBe('sess-1');
    expect(snaps[0]?.phase.phase).toBe('connected');
    expect(await bus.invoke('connection.activeWorkspace')).toBe('sess-1');
  });

  it('runs a turn and broadcasts runner.turn.complete', async () => {
    const bus = new FakeBus();
    const { session } = fakeSession();
    const host = new MobileSessionHost(bus, session);
    host.register();
    host.wire();
    const { turnId } = (await bus.invoke('session.runTurn', { prompt: 'hi' })) as { turnId: string };
    expect(typeof turnId).toBe('string');
    expect((session as unknown as { runTurn: ReturnType<typeof vi.fn> }).runTurn).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0)); // let the drain pump settle
    const done = bus.event('runner.turn.complete');
    expect(done.some((e) => e.payload.turnId === turnId && e.payload.error === null)).toBe(true);
  });

  it('mirrors session events to runner.event', () => {
    const bus = new FakeBus();
    const { session, emit } = fakeSession();
    const host = new MobileSessionHost(bus, session);
    host.wire();
    emit({ kind: 'assistant_message', text: 'yo' });
    const evts = bus.event('runner.event');
    expect(evts.some((e) => e.payload.workspaceId === 'sess-1' && (e.payload.event as any).text === 'yo')).toBe(
      true,
    );
  });

  it('forwards inline attachments to session.runTurn (path attachments are ignored)', async () => {
    const bus = new FakeBus();
    const { session, raw } = fakeSession();
    const host = new MobileSessionHost(bus, session);
    host.register();
    const inline = [{ kind: 'image', content: 'AAAA', name: 'shot.png', mediaType: 'image/png' }];
    await bus.invoke('session.runTurn', { prompt: 'look', inlineAttachments: inline });
    const opts = (raw.runTurn as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      attachments?: unknown;
    };
    expect(opts.attachments).toEqual(inline);
  });

  it('switches mode via session.setMode and re-broadcasts the connected phase', async () => {
    const bus = new FakeBus();
    const { session, raw } = fakeSession();
    const host = new MobileSessionHost(bus, session);
    host.register();
    await bus.invoke('session.setMode', { mode: 'goal' });
    expect((raw.modes as { setActive: ReturnType<typeof vi.fn> }).setActive).toHaveBeenCalledWith('goal');
    const changed = bus.event('connection.changed');
    expect(changed.some((e) => e.payload.phase.activeMode === 'goal')).toBe(true);
  });

  it('session.newSession prefers reset() and falls back to log.clear()', async () => {
    const bus = new FakeBus();
    const reset = vi.fn(async () => {});
    const withReset = fakeSession({ reset });
    new MobileSessionHost(bus, withReset.session).register();
    await bus.invoke('session.newSession', {});
    expect(reset).toHaveBeenCalled();

    const bus2 = new FakeBus();
    const withoutReset = fakeSession();
    new MobileSessionHost(bus2, withoutReset.session).register();
    await bus2.invoke('session.newSession', {});
    expect((withoutReset.raw.log as { clear: ReturnType<typeof vi.fn> }).clear).toHaveBeenCalled();
  });

  it('runs a registered slash command and reports unknown ones as a typed error', async () => {
    const bus = new FakeBus();
    const { session } = fakeSession();
    new MobileSessionHost(bus, session).register();
    expect(await bus.invoke('session.runCommand', { name: 'echo', args: 'hi' })).toEqual({
      kind: 'text',
      text: 'echo:hi',
    });
    expect(await bus.invoke('session.runCommand', { name: 'nope', args: '' })).toEqual({
      kind: 'error',
      message: 'unknown command: /nope',
    });
  });

  it('voice: hasTranscriber gates on the registry; transcribe is coded not-supported without one', async () => {
    const bus = new FakeBus();
    const { session } = fakeSession(); // no transcribers view at all
    new MobileSessionHost(bus, session).register();
    expect(await bus.invoke('session.hasTranscriber')).toBe(false);
    await expect(bus.invoke('session.transcribe', { audioBase64: 'AAAA' })).rejects.toMatchObject({
      code: 'not-supported',
    });

    const bus2 = new FakeBus();
    const transcribe = vi.fn(async () => ({ text: 'hello moxxy' }));
    const withStt = fakeSession({
      transcribers: { tryGetActive: () => ({ name: 'whisper', transcribe }) },
    });
    new MobileSessionHost(bus2, withStt.session).register();
    expect(await bus2.invoke('session.hasTranscriber')).toBe(true);
    expect(await bus2.invoke('session.transcribe', { audioBase64: 'AAAA', mimeType: 'audio/m4a' })).toBe(
      'hello moxxy',
    );
    expect(transcribe).toHaveBeenCalledWith(expect.any(Buffer), { mimeType: 'audio/m4a' });
  });

  it('workflows degrade when the plugin is absent and delegate when present', async () => {
    const bus = new FakeBus();
    const { session } = fakeSession(); // no workflows view
    new MobileSessionHost(bus, session).register();
    expect(await bus.invoke('workflows.list')).toEqual([]);
    await expect(bus.invoke('workflows.setEnabled', { name: 'daily', enabled: true })).resolves.toBeUndefined();
    await expect(bus.invoke('workflows.run', { name: 'daily' })).rejects.toMatchObject({
      code: 'not-supported',
    });

    const bus2 = new FakeBus();
    const view = {
      list: vi.fn(async () => [
        { name: 'daily', description: '', enabled: true, scope: 'user', steps: 1, triggers: 'on-demand' },
      ]),
      setEnabled: vi.fn(async () => {}),
      run: vi.fn(async () => ({ ok: true, output: 'done', steps: [] })),
    };
    const withWorkflows = fakeSession({ workflows: view });
    new MobileSessionHost(bus2, withWorkflows.session).register();
    expect(await bus2.invoke('workflows.list')).toHaveLength(1);
    await bus2.invoke('workflows.setEnabled', { name: 'daily', enabled: false });
    expect(view.setEnabled).toHaveBeenCalledWith('daily', false);
    expect(await bus2.invoke('workflows.run', { name: 'daily' })).toMatchObject({ ok: true });
  });

  it('routes a permission prompt through ask.request → ask.respond', async () => {
    const bus = new FakeBus();
    const { session, getPermissionResolver } = fakeSession();
    const host = new MobileSessionHost(bus, session);
    host.register();
    host.wire();
    const resolver = getPermissionResolver();
    const verdict = resolver.check({ name: 'web_fetch', input: {} }, {});
    const ask = bus.event('ask.request')[0];
    expect(ask?.payload.kind).toBe('permission');
    await bus.invoke('ask.respond', { requestId: ask!.payload.requestId, response: { mode: 'allow' } });
    await expect(verdict).resolves.toEqual({ mode: 'allow' });
  });

  it('fails closed: a permission check after dispose() resolves to deny instead of hanging', async () => {
    const bus = new FakeBus();
    const { session, getPermissionResolver } = fakeSession();
    const host = new MobileSessionHost(bus, session);
    host.register();
    host.wire();
    const resolver = getPermissionResolver();
    host.dispose();
    const before = bus.event('ask.request').length;
    await expect(resolver.check({ name: 'web_fetch', input: {} }, {})).resolves.toEqual({ mode: 'deny' });
    // No new ask was broadcast to the (now closed) bus.
    expect(bus.event('ask.request').length).toBe(before);
  });

  it('newSession resets auto-approve to the safe default', async () => {
    const bus = new FakeBus();
    const { session, getPermissionResolver } = fakeSession();
    const host = new MobileSessionHost(bus, session);
    host.register();
    host.wire();
    await bus.invoke('session.setAutoApprove', { enabled: true });
    // While auto-approve is on, checks short-circuit to allow (no ask).
    await expect(getPermissionResolver().check({ name: 'web_fetch', input: {} }, {})).resolves.toEqual({
      mode: 'allow',
    });
    await bus.invoke('session.newSession', {});
    // After /new, a check opens an ask again rather than auto-allowing.
    const verdict = getPermissionResolver().check({ name: 'web_fetch', input: {} }, {});
    const ask = bus.event('ask.request').at(-1);
    expect(ask?.payload.kind).toBe('permission');
    await bus.invoke('ask.respond', { requestId: ask!.payload.requestId, response: { mode: 'deny' } });
    await expect(verdict).resolves.toEqual({ mode: 'deny' });
  });

  it('onAllClientsDisconnected aborts the in-flight turn and denies the parked ask (host stays usable)', async () => {
    const bus = new FakeBus();
    // A turn that hangs until its abort signal fires, so a disconnect must abort it.
    const aborts: AbortSignal[] = [];
    const session = fakeSession({
      runTurn: vi.fn((_p: string, opts?: { signal?: AbortSignal }) => {
        if (opts?.signal) aborts.push(opts.signal);
        return (async function* () {
          await new Promise<void>((resolve) => opts?.signal?.addEventListener('abort', () => resolve()));
        })();
      }),
    });
    const host = new MobileSessionHost(bus, session.session);
    host.register();
    host.wire();
    await bus.invoke('session.runTurn', { prompt: 'hang' });
    const resolver = session.getPermissionResolver();
    const verdict = resolver.check({ name: 'web_fetch', input: {} }, {});
    await new Promise((r) => setTimeout(r, 0));
    expect(bus.event('ask.request').length).toBe(1);

    host.onAllClientsDisconnected();

    expect(aborts[0]?.aborted).toBe(true);
    // The parked ask self-denies rather than hanging the runner forever.
    await expect(verdict).resolves.toEqual({ mode: 'deny' });
    // NOT disposed: a reconnecting client can still drive the host.
    const verdict2 = resolver.check({ name: 'web_fetch', input: {} }, {});
    const ask2 = bus.event('ask.request').at(-1);
    await bus.invoke('ask.respond', { requestId: ask2!.payload.requestId, response: { mode: 'allow' } });
    await expect(verdict2).resolves.toEqual({ mode: 'allow' });
  });

  it('a parked ask self-denies after the timeout instead of hanging the runner', async () => {
    vi.useFakeTimers();
    try {
      const bus = new FakeBus();
      const { session } = fakeSession();
      const host = new MobileSessionHost(bus, session, { askTimeoutMs: 1000 });
      host.register();
      host.wire();
      const verdict = host.permissionResolver.check({ name: 'web_fetch', input: {} } as any, {} as any);
      expect(bus.event('ask.request').length).toBe(1);
      // No ask.respond ever arrives — the grace elapses.
      vi.advanceTimersByTime(1000);
      await expect(verdict).resolves.toEqual({ mode: 'deny' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps concurrently parked asks: past the cap a new permission check denies immediately', async () => {
    const bus = new FakeBus();
    const { session } = fakeSession();
    // Disable the timeout so the parked asks stay parked and accumulate.
    const host = new MobileSessionHost(bus, session, { askTimeoutMs: 0 });
    host.register();
    host.wire();
    const pending: Array<Promise<unknown>> = [];
    for (let i = 0; i < 256; i++) {
      pending.push(host.permissionResolver.check({ name: 'web_fetch', input: {} } as any, {} as any));
    }
    expect(bus.event('ask.request').length).toBe(256);
    // The 257th check is over the cap → denied without broadcasting another ask.
    await expect(
      host.permissionResolver.check({ name: 'web_fetch', input: {} } as any, {} as any),
    ).resolves.toEqual({ mode: 'deny' });
    expect(bus.event('ask.request').length).toBe(256);
    // Drain the parked promises so the test doesn't leak resolvers.
    host.dispose();
    await Promise.all(pending);
  });

  it('a non-serializable session event does not throw out of the log subscriber', () => {
    const bus = new FakeBus();
    const errs: unknown[] = [];
    // A bus whose broadcast throws on a bad event, mimicking JSON.stringify
    // blowing up inside notify for a BigInt / circular payload.
    const throwingBus: CommandBus & EventSink = {
      handle: () => {},
      broadcast: (channel: string, payload: unknown) => {
        if (channel === 'runner.event' && (payload as any)?.event?.bad) throw new TypeError('not serializable');
        bus.broadcast(channel, payload);
      },
    };
    const { session, emit } = fakeSession();
    const host = new MobileSessionHost(throwingBus, session, { logErr: (e) => errs.push(e) });
    host.wire();
    // Emitting a bad event must not unwind back into the session's emit loop.
    expect(() => emit({ kind: 'assistant_message', bad: true })).not.toThrow();
    expect(errs).toHaveLength(1);
  });
});
