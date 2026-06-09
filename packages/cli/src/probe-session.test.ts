import * as os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { definePlugin } from '@moxxy/sdk';
import { probeSession, type SetupOptions, type SetupResult } from './setup.js';

/**
 * Harness: a real `Session` with a spy plugin on its hook dispatcher, plus a
 * fake boot fn that honours the one piece of the real
 * `setupSessionWithConfig` contract under test here — init hooks are
 * dispatched unless `skipInitHooks` is set (setup.ts line: `if
 * (!opts.skipInitHooks) await session.dispatcher.dispatchInit(...)`).
 */
function makeHarness(): {
  session: Session;
  onInit: ReturnType<typeof vi.fn>;
  onShutdown: ReturnType<typeof vi.fn>;
  boot: (opts: SetupOptions) => Promise<SetupResult>;
  bootCalls: SetupOptions[];
} {
  const onInit = vi.fn();
  const onShutdown = vi.fn();
  const session = new Session({ cwd: os.tmpdir(), logger: silentLogger });
  session.dispatcher.setPlugins([
    definePlugin({ name: 'spy-plugin', hooks: { onInit, onShutdown } }),
  ]);
  const bootCalls: SetupOptions[] = [];
  const boot = async (opts: SetupOptions): Promise<SetupResult> => {
    bootCalls.push(opts);
    if (!opts.skipInitHooks) await session.dispatcher.dispatchInit(session.appContext());
    return { session } as unknown as SetupResult;
  };
  return { session, onInit, onShutdown, boot, bootCalls };
}

describe('probeSession', () => {
  it('forces skipInitHooks + disableSessionPersistence so a probe never starts init-hook daemons', async () => {
    const h = makeHarness();
    const answer = await probeSession(
      { cwd: os.tmpdir(), tolerateNoProvider: true, skipKeyPrompt: true },
      ({ session }) => session.channels.has('definitely-not-a-channel'),
      h.boot,
    );
    expect(answer).toBe(false);
    expect(h.bootCalls).toHaveLength(1);
    expect(h.bootCalls[0]).toMatchObject({
      // Caller flags pass through…
      tolerateNoProvider: true,
      skipKeyPrompt: true,
      // …and the probe flags are forced on.
      skipInitHooks: true,
      disableSessionPersistence: true,
    });
    expect(h.onInit).not.toHaveBeenCalled();
  });

  it('forces the probe flags even when the caller explicitly turns them off', async () => {
    const h = makeHarness();
    await probeSession(
      {
        cwd: os.tmpdir(),
        skipInitHooks: false,
        disableSessionPersistence: false,
      } as SetupOptions,
      () => undefined,
      h.boot,
    );
    expect(h.bootCalls[0]).toMatchObject({
      skipInitHooks: true,
      disableSessionPersistence: true,
    });
    expect(h.onInit).not.toHaveBeenCalled();
  });

  it('closes the probe session before returning the answer (onShutdown fires)', async () => {
    const h = makeHarness();
    const answer = await probeSession({ cwd: os.tmpdir() }, () => 42, h.boot);
    expect(answer).toBe(42);
    expect(h.onShutdown).toHaveBeenCalledTimes(1);
    // Idempotence: a later close (e.g. a shared signal handler) is a no-op.
    await h.session.close();
    expect(h.onShutdown).toHaveBeenCalledTimes(1);
  });

  it('supports an async read that uses the live session, closing only after it resolves', async () => {
    const h = makeHarness();
    const answer = await probeSession(
      { cwd: os.tmpdir() },
      async ({ session }) => {
        // The session must not be shut down while read runs.
        expect(h.onShutdown).not.toHaveBeenCalled();
        return session.channels.list().length;
      },
      h.boot,
    );
    expect(answer).toBe(0);
    expect(h.onShutdown).toHaveBeenCalledTimes(1);
  });

  it('closes the probe session even when read throws, and rethrows the original error', async () => {
    const h = makeHarness();
    await expect(
      probeSession(
        { cwd: os.tmpdir() },
        () => {
          throw new Error('boom');
        },
        h.boot,
      ),
    ).rejects.toThrow('boom');
    expect(h.onShutdown).toHaveBeenCalledTimes(1);
  });

  it('never lets a close failure mask the answer', async () => {
    const close = vi.fn().mockRejectedValue(new Error('close failed'));
    const boot = async (): Promise<SetupResult> =>
      ({ session: { close } } as unknown as SetupResult);
    await expect(probeSession({ cwd: os.tmpdir() }, () => 'ok', boot)).resolves.toBe('ok');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
