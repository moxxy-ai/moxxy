/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles cast loosely */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClientSession } from '@moxxy/sdk';

// startWsBridge is the post-wire step that can reject (e.g. EADDRINUSE on the
// default port, shared with the desktop bridge). Mock it so we can drive the
// failure path without binding a real socket.
const startWsBridge = vi.fn();
vi.mock('@moxxy/ipc-server-ws', () => ({
  WebSocketCommandBus: class {
    constructor(_opts: unknown) {}
    handle() {}
    broadcast() {}
  },
  startWsBridge: (...args: unknown[]) => startWsBridge(...args),
}));

// Keep the QR/printing side-effect-free (it shouldn't be reached on the failure
// path anyway, since startWsBridge rejects first).
vi.mock('./qr.js', () => ({ printConnectInfo: vi.fn(async () => {}) }));

import { MobileChannel } from './channel.js';
import { MobileSessionHost } from './single-session-host.js';

/** A session that records log subscription + resolver installs/clears. */
function fakeSession() {
  const logSubs = new Set<(e: unknown) => void>();
  const unsubscribe = vi.fn();
  let permissionResolver: any = null;
  let approvalResolver: any = null;
  const session = {
    id: 'sess-1',
    cwd: '/tmp',
    permissions: { addAllow: vi.fn(async () => {}) },
    log: {
      subscribe: vi.fn((fn: (e: unknown) => void) => {
        logSubs.add(fn);
        return () => {
          unsubscribe();
          logSubs.delete(fn);
        };
      }),
      clear: vi.fn(),
    },
    runTurn: vi.fn(() => (async function* () {})()),
    getInfo: () => ({
      sessionId: 'sess-1',
      providers: [],
      modes: [],
      activeProvider: 'openai',
      activeMode: 'default',
      activeModeBadge: null,
    }),
    modes: { setActive: vi.fn() },
    commands: { get: () => undefined },
    setPermissionResolver: vi.fn((r: unknown) => {
      permissionResolver = r;
    }),
    setApprovalResolver: vi.fn((r: unknown) => {
      approvalResolver = r;
    }),
  };
  return {
    session: session as unknown as ClientSession,
    raw: session,
    unsubscribe,
    activeSubs: () => logSubs.size,
    getPermissionResolver: () => permissionResolver,
    getApprovalResolver: () => approvalResolver,
  };
}

describe('MobileChannel.start teardown on startup failure', () => {
  beforeEach(() => {
    startWsBridge.mockReset();
  });

  it('disposes the host (unsubscribes log + clears the approval resolver) when startWsBridge rejects', async () => {
    startWsBridge.mockRejectedValue(new Error('EADDRINUSE'));
    const { session, raw, unsubscribe, activeSubs, getApprovalResolver } = fakeSession();
    const channel = new MobileChannel({ token: 'tok', tunnel: 'localhost' });

    await expect(channel.start({ session })).rejects.toThrow('EADDRINUSE');

    // wire() subscribed to session.log; the catch must have torn it back down.
    expect(raw.log.subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(activeSubs()).toBe(0);

    // The approval resolver must be cleared back to null (dispose contract).
    expect(getApprovalResolver()).toBeNull();
    expect(raw.setApprovalResolver).toHaveBeenLastCalledWith(null);
  });

  it('leaves the channel owning nothing after a failed start (host/server nulled)', async () => {
    startWsBridge.mockRejectedValue(new Error('EADDRINUSE'));
    const { session } = fakeSession();
    const channel = new MobileChannel({ token: 'tok', tunnel: 'localhost' });

    await expect(channel.start({ session })).rejects.toThrow();

    // permissionResolver delegates to the live host; with the host nulled it
    // must deny rather than route into a torn-down bus.
    const res = await channel.permissionResolver.check(
      { name: 'shell', input: {} } as any,
      {} as any,
    );
    expect(res.mode).toBe('deny');
  });
});

/** A live-server stub for the happy path: `clientCount` is caller-controlled so
 *  a test can simulate a connect→disconnect transition. `onConnection` captures
 *  the channel's handler so a test can fire a synchronous "client attached"
 *  edge (the rising edge the poll alone can miss). */
function fakeServer(clientCount: () => number) {
  const connectionHandlers: Array<(t: unknown) => void> = [];
  return {
    address: 'ws://127.0.0.1:8765',
    clientCount: vi.fn(() => clientCount()),
    onConnection: vi.fn((h: (t: unknown) => void) => {
      connectionHandlers.push(h);
    }),
    /** Fire every registered onConnection handler (simulate a client attaching). */
    fireConnection: () => connectionHandlers.forEach((h) => h({})),
    setAllowedOrigins: vi.fn(),
    rotateAuthToken: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

describe('MobileChannel disconnect sweep', () => {
  beforeEach(() => {
    startWsBridge.mockReset();
    vi.useRealTimers();
  });

  it('aborts the host on the connected→disconnected zero-crossing and clears the timer on stop', async () => {
    vi.useFakeTimers();
    let connected = 0;
    const server = fakeServer(() => connected);
    startWsBridge.mockResolvedValue(server as any);
    const { session } = fakeSession();
    const channel = new MobileChannel({ token: 'tok', tunnel: 'localhost' });
    const handle = await channel.start({ session });

    // A client connects, then drops; the sweep must drive host.onAllClientsDisconnected.
    connected = 1;
    vi.advanceTimersByTime(1000);
    connected = 0;
    vi.advanceTimersByTime(1000);
    // clientCount was polled (sweep alive).
    expect(server.clientCount).toHaveBeenCalled();
    const pollsBeforeStop = server.clientCount.mock.calls.length;

    await handle.stop();
    // After stop the timer is cleared: no further polling.
    vi.advanceTimersByTime(5000);
    expect(server.clientCount.mock.calls.length).toBe(pollsBeforeStop);
    vi.useRealTimers();
  });

  it('drains a fast-crashing client whose connect the poll never saw (rising edge via onConnection)', async () => {
    vi.useFakeTimers();
    const drain = vi
      .spyOn(MobileSessionHost.prototype, 'onAllClientsDisconnected')
      .mockImplementation(() => {});
    try {
      // clientCount() is ALWAYS 0: the client connected and died entirely
      // within a single poll window, so no poll ever observes n>0. Only the
      // onConnection edge proves a client was here — the falling-edge poll must
      // still drain it, or the stranded turn/ask leaks forever.
      const server = fakeServer(() => 0);
      startWsBridge.mockResolvedValue(server as any);
      const { session } = fakeSession();
      const handle = await new MobileChannel({ token: 'tok', tunnel: 'localhost' }).start({ session });

      // The channel registered its rising-edge handler.
      expect(server.onConnection).toHaveBeenCalled();
      // A client attaches and is gone before any poll runs.
      server.fireConnection();
      // Next poll sees count 0 with sawClient already true → drains.
      vi.advanceTimersByTime(1000);
      expect(drain).toHaveBeenCalledTimes(1);
      // Edge-triggered: a second poll with no new connection must NOT re-drain.
      vi.advanceTimersByTime(1000);
      expect(drain).toHaveBeenCalledTimes(1);

      await handle.stop();
    } finally {
      drain.mockRestore();
      vi.useRealTimers();
    }
  });

  it('passes allowQueryToken through and closes it via MOXXY_MOBILE_QUERY_TOKEN', async () => {
    const server = fakeServer(() => 0);
    startWsBridge.mockResolvedValue(server as any);
    const { session } = fakeSession();

    await (await new MobileChannel({ token: 'tok' }).start({ session })).stop();
    expect(startWsBridge.mock.calls.at(-1)?.[1]).toMatchObject({ allowQueryToken: true });

    startWsBridge.mockResolvedValue(fakeServer(() => 0) as any);
    await (await new MobileChannel({ token: 'tok', allowQueryToken: false }).start({ session })).stop();
    expect(startWsBridge.mock.calls.at(-1)?.[1]).toMatchObject({ allowQueryToken: false });

    process.env.MOXXY_MOBILE_QUERY_TOKEN = '0';
    try {
      startWsBridge.mockResolvedValue(fakeServer(() => 0) as any);
      await (await new MobileChannel({ token: 'tok', allowQueryToken: true }).start({ session })).stop();
      expect(startWsBridge.mock.calls.at(-1)?.[1]).toMatchObject({ allowQueryToken: false });
    } finally {
      delete process.env.MOXXY_MOBILE_QUERY_TOKEN;
    }
  });
});

describe('MobileChannel.rotateToken with a pinned token', () => {
  it('refuses to rotate (no-op + warn) when the token is supplied via config', () => {
    const warn = vi.fn();
    const channel = new MobileChannel({ token: 'pinned-tok', logger: { warn } });
    const before = channel.rotateToken();
    expect(before).toBe('pinned-tok');
    expect(warn).toHaveBeenCalled();
  });
});
