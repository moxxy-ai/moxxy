import { describe, expect, it, vi } from 'vitest';

// `./shared` value-imports `ipcMain` from electron, whose index.js throws at
// import time unless the platform binary is installed. These are pure-plumbing
// unit tests, so stub electron — importing it must not require the GUI binary.
vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type {
  IpcCommandName,
  IpcCommands,
  MobileGatewayStatus,
} from '@moxxy/desktop-ipc-contract';
import type { CommandBus, IpcDispatchResult } from '@moxxy/desktop-ipc-contract/bus';
import { dispatch } from '@moxxy/desktop-ipc-contract/dispatch';
import { setActiveBus } from './shared';
import {
  registerMobileGatewayHandlers,
  type MobileGatewayController,
} from './mobile-gateway';

/**
 * A CommandBus that captures the registered handler fns so a test can dispatch
 * through the SAME validate→run→classify core the real transports use. The
 * handlers are registered via the shared `handle()` choke point, so this also
 * proves they go through validation.
 */
function captureBus(): {
  bus: CommandBus;
  call: <K extends IpcCommandName>(
    channel: K,
    ...args: Parameters<IpcCommands[K]>
  ) => Promise<IpcDispatchResult>;
} {
  const handlers = new Map<IpcCommandName, (...a: never[]) => Promise<unknown>>();
  const bus: CommandBus = {
    handle: ((channel, fn) => handlers.set(channel, fn as never)) as CommandBus['handle'],
  };
  return {
    bus,
    call: async (channel, ...args) => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`no handler for ${channel}`);
      return dispatch(channel, args as never, fn as never);
    },
  };
}

const ON: MobileGatewayStatus = {
  enabled: true,
  host: '192.168.1.7',
  port: 8765,
  connectUrl: 'ws://192.168.1.7:8765/?t=tok',
  token: 'tok',
  clientCount: 0,
};
const OFF: MobileGatewayStatus = {
  enabled: false,
  host: null,
  port: null,
  connectUrl: null,
  token: null,
};

function fakeController(): MobileGatewayController & {
  calls: string[];
  enabled: boolean;
} {
  const state = { enabled: false };
  const calls: string[] = [];
  return {
    calls,
    get enabled() {
      return state.enabled;
    },
    status: () => (state.enabled ? ON : OFF),
    setEnabled: (enabled: boolean) => {
      calls.push(`setEnabled(${enabled})`);
      state.enabled = enabled;
      return Promise.resolve(enabled ? ON : OFF);
    },
    rotateToken: () => {
      calls.push('rotateToken');
      return Promise.resolve(state.enabled ? { ...ON, token: 'rotated', connectUrl: 'ws://192.168.1.7:8765/?t=rotated' } : OFF);
    },
  };
}

describe('mobileGateway IPC handlers', () => {
  it('status returns the controller snapshot', async () => {
    const { bus, call } = captureBus();
    const ctrl = fakeController();
    setActiveBus(bus);
    registerMobileGatewayHandlers(ctrl);

    const res = await call('mobileGateway.status');
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.value as MobileGatewayStatus).enabled).toBe(false);
  });

  it('setEnabled(true) starts the gateway and round-trips the status', async () => {
    const { bus, call } = captureBus();
    const ctrl = fakeController();
    setActiveBus(bus);
    registerMobileGatewayHandlers(ctrl);

    const res = await call('mobileGateway.setEnabled', { enabled: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.value as MobileGatewayStatus).enabled).toBe(true);
    expect(ctrl.calls).toContain('setEnabled(true)');
    expect(ctrl.enabled).toBe(true);
  });

  it('setEnabled rejects a non-boolean payload (zod) before the handler runs', async () => {
    const { bus, call } = captureBus();
    const ctrl = fakeController();
    setActiveBus(bus);
    registerMobileGatewayHandlers(ctrl);

    // @ts-expect-error — deliberately wrong payload to exercise validation.
    const res = await call('mobileGateway.setEnabled', { enabled: 'yes' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid-payload');
    // The controller must NOT have been touched.
    expect(ctrl.calls).toHaveLength(0);
  });

  it('setEnabled rejects an unknown key (.strict)', async () => {
    const { bus, call } = captureBus();
    const ctrl = fakeController();
    setActiveBus(bus);
    registerMobileGatewayHandlers(ctrl);

    // @ts-expect-error — extra key rejected by .strict().
    const res = await call('mobileGateway.setEnabled', { enabled: true, evil: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('invalid-payload');
  });

  it('rotateToken delegates and yields a fresh token', async () => {
    const { bus, call } = captureBus();
    const ctrl = fakeController();
    setActiveBus(bus);
    registerMobileGatewayHandlers(ctrl);

    await call('mobileGateway.setEnabled', { enabled: true });
    const res = await call('mobileGateway.rotateToken');
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.value as MobileGatewayStatus).token).toBe('rotated');
    expect(ctrl.calls).toContain('rotateToken');
  });

  it('reports not-supported when no controller is wired', async () => {
    const { bus, call } = captureBus();
    setActiveBus(bus);
    registerMobileGatewayHandlers(null);

    const res = await call('mobileGateway.status');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not-supported');
  });
});
