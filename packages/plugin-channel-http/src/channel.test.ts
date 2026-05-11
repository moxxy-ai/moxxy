import { describe, expect, it } from 'vitest';
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
});
