/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles cast loosely */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSession } from '@moxxy/sdk';

const startWsBridge = vi.fn();
vi.mock('@moxxy/ipc-server-ws', () => ({
  WebSocketCommandBus: class {
    constructor(_opts: unknown) {}
    handle() {}
    broadcast() {}
  },
  startWsBridge: (...args: unknown[]) => startWsBridge(...args),
}));

vi.mock('./qr.js', () => ({ printConnectInfo: vi.fn(async () => {}) }));

import { MobileChannel } from './channel.js';

function fakeBridgeServer() {
  return {
    address: { host: '127.0.0.1', port: 8765 },
    close: vi.fn(async () => {}),
    rotateAuthToken: vi.fn(),
    setAllowedOrigins: vi.fn(),
  };
}

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
    runTurn: vi.fn(() => (async function* runTurn() {})()),
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

    expect(raw.log.subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(activeSubs()).toBe(0);

    expect(getApprovalResolver()).toBeNull();
    expect(raw.setApprovalResolver).toHaveBeenLastCalledWith(null);
  });

  it('leaves the channel owning nothing after a failed start (host/server nulled)', async () => {
    startWsBridge.mockRejectedValue(new Error('EADDRINUSE'));
    const { session } = fakeSession();
    const channel = new MobileChannel({ token: 'tok', tunnel: 'localhost' });

    await expect(channel.start({ session })).rejects.toThrow();

    const res = await channel.permissionResolver.check(
      { name: 'shell', input: {} } as any,
      {} as any,
    );
    expect(res.mode).toBe('deny');
  });
});

describe('MobileChannel Expo startup', () => {
  beforeEach(() => {
    startWsBridge.mockReset();
    startWsBridge.mockResolvedValue(fakeBridgeServer());
  });

  it('starts Expo beside the mobile bridge and stops it with the channel', async () => {
    const stopExpo = vi.fn(async () => {});
    const startExpo = vi.fn(async () => ({ stop: stopExpo }));
    const channel = new MobileChannel({ port: 0 }, { startExpoApp: startExpo });

    const handle = await channel.start({ session: fakeSession().session });

    expect(startExpo).toHaveBeenCalledWith({
      enabled: true,
      host: 'lan',
      port: 8081,
    });

    await handle.stop('test');

    expect(stopExpo).toHaveBeenCalled();
  });
});
