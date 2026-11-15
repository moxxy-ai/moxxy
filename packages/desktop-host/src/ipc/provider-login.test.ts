import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { RunnerPool } from '../runner-pool';

const h = vi.hoisted(() => ({
  startProviderLogin: vi.fn(),
  cancelProviderLogin: vi.fn(),
  runProviderLogout: vi.fn(),
  window: { once: vi.fn() },
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => h.window,
    getAllWindows: () => [],
  },
}));

vi.mock('../provider-login', () => ({
  answerProviderLogin: vi.fn(),
  cancelProviderLogin: h.cancelProviderLogin,
  startProviderLogin: h.startProviderLogin,
  runProviderLogout: h.runProviderLogout,
}));

import { registerProviderLoginHandlers } from './provider-login';
import { setActiveBus } from './shared';

type Handler = (...args: never[]) => Promise<unknown>;

function register(pool: RunnerPool): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const bus = {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
  } as unknown as CommandBus;
  setActiveBus(bus);
  registerProviderLoginHandlers(pool);
  return handlers;
}

function deferred(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    release: () => {
      if (!release) throw new Error('deferred preparation was not initialized');
      release();
    },
  };
}

beforeEach(() => {
  h.startProviderLogin.mockReset();
  h.cancelProviderLogin.mockReset();
  h.window.once.mockReset();
});

describe('provider login IPC preparation', () => {
  it('does not spawn the login CLI until desktop plugin preparation finishes', async () => {
    const preparation = deferred();
    const prepare = vi.fn(() => preparation.promise);
    const pool = {
      prepare,
      active: () => null,
    } as unknown as RunnerPool;
    const start = register(pool).get('provider.login.start');
    if (!start) throw new Error('provider.login.start handler was not registered');

    const pending = start({ loginId: 'login-1', provider: 'codex-agent' } as never);
    await Promise.resolve();

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(h.startProviderLogin).not.toHaveBeenCalled();

    preparation.release();
    await pending;

    expect(h.startProviderLogin).toHaveBeenCalledWith(
      'login-1',
      'codex-agent',
      h.window,
      expect.any(Object),
    );
  });

  it('surfaces preparation failure without spawning an incomplete login CLI', async () => {
    const failure = new Error('plugins-seed copy failed');
    const pool = {
      prepare: vi.fn(async () => Promise.reject(failure)),
      active: () => null,
    } as unknown as RunnerPool;
    const start = register(pool).get('provider.login.start');
    if (!start) throw new Error('provider.login.start handler was not registered');

    await expect(
      start({ loginId: 'login-failed', provider: 'codex-agent' } as never),
    ).rejects.toBe(failure);
    expect(h.startProviderLogin).not.toHaveBeenCalled();
  });

  it('does not spawn a login that was cancelled while preparation was pending', async () => {
    const preparation = deferred();
    const pool = {
      prepare: vi.fn(() => preparation.promise),
      active: () => null,
    } as unknown as RunnerPool;
    const handlers = register(pool);
    const start = handlers.get('provider.login.start');
    const cancel = handlers.get('provider.login.cancel');
    if (!start || !cancel) throw new Error('provider login handlers were not registered');

    const pending = start({ loginId: 'login-cancelled', provider: 'codex-agent' } as never);
    await Promise.resolve();
    await cancel({ loginId: 'login-cancelled' } as never);
    preparation.release();
    await pending;

    expect(h.cancelProviderLogin).toHaveBeenCalledWith('login-cancelled');
    expect(h.startProviderLogin).not.toHaveBeenCalled();
  });
});

describe('provider sign-out IPC', () => {
  function poolWith(): { pool: RunnerPool; forceRetry: ReturnType<typeof vi.fn>; checkAgents: ReturnType<typeof vi.fn> } {
    const forceRetry = vi.fn();
    const checkAgents = vi.fn(async () => undefined);
    const runner = { getInfo: () => ({}), providerAdmin: { checkAgents } };
    const pool = {
      prepare: vi.fn(async () => undefined),
      active: () => ({ forceRetry }),
      list: () => [{ supervisor: { remote: () => runner } }],
    } as unknown as RunnerPool;
    return { pool, forceRetry, checkAgents };
  }

  it('signs out, drops the runner\'s account, and has every runner check its agents again', async () => {
    h.runProviderLogout.mockResolvedValue({ ok: true, message: 'logged out' });
    const { pool, forceRetry, checkAgents } = poolWith();
    const logout = register(pool).get('provider.logout');
    if (!logout) throw new Error('provider.logout handler was not registered');

    await expect(logout({ provider: 'codex-agent' } as never)).resolves.toEqual({ ok: true, message: 'logged out' });
    expect(h.runProviderLogout).toHaveBeenCalledWith('codex-agent');
    expect(forceRetry).toHaveBeenCalledTimes(1);
    expect(checkAgents).toHaveBeenCalledTimes(1);
  });

  it('still checks the agents after a failed sign-out, and says why it failed', async () => {
    h.runProviderLogout.mockResolvedValue({ ok: false, message: 'Codex logout failed' });
    const { pool, forceRetry, checkAgents } = poolWith();
    const logout = register(pool).get('provider.logout');
    if (!logout) throw new Error('provider.logout handler was not registered');

    await expect(logout({ provider: 'codex-agent' } as never)).resolves.toEqual({ ok: false, message: 'Codex logout failed' });
    expect(forceRetry).not.toHaveBeenCalled();
    expect(checkAgents).toHaveBeenCalledTimes(1);
  });
});
