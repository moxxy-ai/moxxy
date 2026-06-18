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
});
