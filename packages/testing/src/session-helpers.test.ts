import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePlugin } from '@moxxy/sdk';
import type { Session } from '@moxxy/core';
import { FakeProvider, textReply } from './fake-provider.js';
import { createFakeSession } from './session-helpers.js';

// The returned Session owns surfaces + plugins whose onShutdown disposes real
// resources; every test here closes it in afterEach so the suite itself models
// the leak-free lifecycle the helper's JSDoc requires.
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('createFakeSession', () => {
  it('wires a fake provider as active', () => {
    const provider = new FakeProvider({ script: [textReply('hi')] });
    session = createFakeSession({ provider });
    expect(session.providers.getActive().name).toBe(provider.name);
  });

  it('registers caller-supplied plugins and fires their onShutdown on close()', async () => {
    const provider = new FakeProvider({ script: [textReply('hi')] });
    const onShutdown = vi.fn();
    const plugin = definePlugin({ name: 'leaky-plugin', version: '0.0.0', hooks: { onShutdown } });
    session = createFakeSession({ provider, plugins: [plugin] });
    // close() is the affordance the JSDoc points callers at — it must drain the
    // resource-owning plugin's shutdown hook so nothing leaks across the suite.
    await session.close();
    session = undefined; // already closed; keep afterEach a no-op
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it('close() is idempotent — a double-close in overlapping teardown does not throw', async () => {
    const provider = new FakeProvider({ script: [textReply('hi')] });
    const onShutdown = vi.fn();
    session = createFakeSession({
      provider,
      plugins: [definePlugin({ name: 'p', version: '0.0.0', hooks: { onShutdown } })],
    });
    await session.close();
    await expect(session.close()).resolves.toBeUndefined();
    // Shutdown hooks fire exactly once despite the second close.
    expect(onShutdown).toHaveBeenCalledTimes(1);
    session = undefined;
  });

  it('defaults cwd to process.cwd() when none is supplied', () => {
    const provider = new FakeProvider({ script: [textReply('hi')] });
    session = createFakeSession({ provider });
    expect(session.cwd).toBe(process.cwd());
  });
});
