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
