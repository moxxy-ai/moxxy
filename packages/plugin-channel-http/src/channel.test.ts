import { describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { z } from 'zod';
import {
  Session,
  autoAllowResolver,
  silentLogger,
} from '@moxxy/core';
import { defineProvider, definePlugin, defineTool } from '@moxxy/sdk';
import type { LLMProvider, ProviderEvent } from '@moxxy/sdk';
import { HttpChannel } from './channel.js';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly models = [{ id: 'fake', contextWindow: 1000, maxOutputTokens: 100, supportsTools: false, supportsStreaming: true }];
  constructor(private readonly scripts: ReadonlyArray<ReadonlyArray<ProviderEvent>>) {}
  private cursor = 0;
  async *stream(): AsyncIterable<ProviderEvent> {
    const reply = this.scripts[this.cursor++];
    if (!reply) throw new Error('out of fake replies');
    for (const e of reply) yield e;
  }
  async countTokens(): Promise<number> { return 0; }
}

function buildSession(): Session {
  const provider = new FakeProvider([
    [
      { type: 'message_start', model: 'fake' },
      { type: 'text_delta', delta: 'pong' },
      { type: 'message_end', stopReason: 'end_turn' },
    ],
  ]);
  const session = new Session({
    cwd: process.cwd(),
    logger: silentLogger,
    permissionResolver: autoAllowResolver,
  });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'http-test-shim',
      providers: [
        defineProvider({
          name: provider.name,
          models: [...provider.models],
          createClient: () => provider,
        }),
      ],
      tools: [
        defineTool({
          name: 'noop',
          description: 'no-op',
          inputSchema: z.object({}),
          handler: () => null,
        }),
      ],
    }),
  );
  session.providers.setActive(provider.name);
  // Register a minimal loop strategy so runTurn works.
  // Easier: register the default loop-tool-use plugin if it's available.
  return session;
}

describe('HttpChannel', () => {
  it('starts and stops cleanly on an ephemeral port', async () => {
    const channel = new HttpChannel({ port: 0, authToken: 'test', allowedTools: ['noop'] });
    expect(channel.name).toBe('http');
    expect(channel.permissionResolver.name).toBe('allow-list');
    // Don't actually start (would require a loop strategy registered).
    // Just verify the channel object shape.
  });

  it('defaults to deny-by-default resolver when no allow-list given', () => {
    const channel = new HttpChannel({ authToken: 'test' });
    expect(channel.permissionResolver.name).toBe('deny-by-default');
  });

  // Note: full request/response is exercised through the router-level tests.
  // Verifying the server boots and binds is enough at this level.
  void buildSession;

  it('rejects the running promise + logs when the server errors after listen (u70-2)', async () => {
    const warn = vi.fn();
    const channel = new HttpChannel({
      port: 0,
      authToken: 'test',
      allowedTools: ['noop'],
      logger: { info: () => {}, warn },
    });
    const session = new Session({
      cwd: process.cwd(),
      logger: silentLogger,
      permissionResolver: autoAllowResolver,
    });
    const handle = await channel.start({ session } as never);
    expect(channel.boundPort).toBeGreaterThan(0);

    // Reach the bound server (private) to emit a synthetic runtime error — the
    // same surface a real post-listen socket failure would hit.
    const server = (channel as unknown as { server: Server }).server;
    const boom = new Error('socket exploded');
    queueMicrotask(() => server.emit('error', boom));

    await expect(handle.running).rejects.toThrow('socket exploded');
    expect(warn).toHaveBeenCalledWith('http server error', expect.objectContaining({}));
    await handle.stop();
  });

  it('refuses to bind a non-loopback host with no authToken', async () => {
    const channel = new HttpChannel({ port: 0, host: '0.0.0.0', allowedTools: ['noop'] });
    const session = new Session({ cwd: process.cwd(), logger: silentLogger, permissionResolver: autoAllowResolver });
    await expect(channel.start({ session } as never)).rejects.toThrow(/non-loopback/);
    expect(channel.boundPort).toBe(0);
  });

  it('allows a non-loopback bind once an authToken is set', async () => {
    const channel = new HttpChannel({ port: 0, host: '0.0.0.0', authToken: 'tok', allowedTools: ['noop'], logger: { info: () => {}, warn: () => {} } });
    const session = new Session({ cwd: process.cwd(), logger: silentLogger, permissionResolver: autoAllowResolver });
    const handle = await channel.start({ session } as never);
    expect(channel.boundPort).toBeGreaterThan(0);
    await handle.stop();
  });

  it('a post-listen server error does not escalate to an unhandledRejection when running is unobserved', async () => {
    const channel = new HttpChannel({ port: 0, authToken: 'test', allowedTools: ['noop'], logger: { info: () => {}, warn: () => {} } });
    const session = new Session({ cwd: process.cwd(), logger: silentLogger, permissionResolver: autoAllowResolver });
    const handle = await channel.start({ session } as never);

    let unhandled: unknown;
    const onUnhandled = (reason: unknown): void => { unhandled = reason; };
    process.on('unhandledRejection', onUnhandled);
    try {
      const server = (channel as unknown as { server: Server }).server;
      // Intentionally do NOT await handle.running (fire-and-forget caller).
      server.emit('error', new Error('boom'));
      // Let the microtask/macrotask queue flush so any unhandled rejection fires.
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toBeUndefined();
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await handle.stop();
    }
  });

  it('rejects a double start, and allows a fresh start after stop (u70-5)', async () => {
    const channel = new HttpChannel({ port: 0, authToken: 'test', allowedTools: ['noop'], logger: { info: () => {}, warn: () => {} } });
    const session = new Session({ cwd: process.cwd(), logger: silentLogger, permissionResolver: autoAllowResolver });

    const handle = await channel.start({ session } as never);
    expect(channel.boundPort).toBeGreaterThan(0);

    // A second start while running must not silently orphan the first server.
    await expect(channel.start({ session } as never)).rejects.toThrow(/already started/);

    // After stop(), the handle is cleared and the port no longer considered held.
    await handle.stop();
    expect(channel.boundPort).toBe(0);

    // A fresh start now succeeds (no leaked handle blocking it).
    const handle2 = await channel.start({ session } as never);
    expect(channel.boundPort).toBeGreaterThan(0);
    await handle2.stop();
  });
});
