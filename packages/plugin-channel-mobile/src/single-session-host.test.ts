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

function fakeSession() {
  const logSubs = new Set<(e: unknown) => void>();
  let permissionResolver: any = null;
  let approvalResolver: any = null;
  const session = {
    id: 'sess-1',
    cwd: '/tmp',
    permissions: { addAllow: vi.fn(async () => {}) },
    log: {
      subscribe: (fn: (e: unknown) => void) => {
        logSubs.add(fn);
        return () => logSubs.delete(fn);
      },
    },
    runTurn: vi.fn((_prompt: string, _opts?: unknown) =>
      (async function* () {
        /* empty turn — completes immediately */
      })(),
    ),
    getInfo: () => ({
      providers: [],
      modes: [],
      activeProvider: 'openai',
      activeMode: 'default',
      activeModeBadge: null,
    }),
    setPermissionResolver: (r: unknown) => {
      permissionResolver = r;
    },
    setApprovalResolver: (r: unknown) => {
      approvalResolver = r;
    },
  };
  return {
    session: session as unknown as ClientSession,
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
});
