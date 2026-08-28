import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { RunnerPool } from '../runner-pool';

const h = vi.hoisted(() => ({
  startProviderLogin: vi.fn(),
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
  cancelProviderLogin: vi.fn(),
  startProviderLogin: h.startProviderLogin,
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

    const pending = start({ loginId: 'login-1', provider: 'openai-codex' } as never);
    await Promise.resolve();

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(h.startProviderLogin).not.toHaveBeenCalled();

    preparation.release();
    await pending;

    expect(h.startProviderLogin).toHaveBeenCalledWith(
      'login-1',
      'openai-codex',
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
      start({ loginId: 'login-failed', provider: 'openai-codex' } as never),
    ).rejects.toBe(failure);
    expect(h.startProviderLogin).not.toHaveBeenCalled();
  });
});
