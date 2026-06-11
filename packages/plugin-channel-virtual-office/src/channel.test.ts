import { afterEach, describe, expect, it } from 'vitest';
import type { ChannelHandle, ModeContext, MoxxyEvent, SessionLike } from '@moxxy/sdk';
import { defineMode, defineProvider, definePlugin } from '@moxxy/sdk';
import { Session } from '@moxxy/core';

import { VirtualOfficeChannel } from './channel.js';

function buildPrimary(): Session {
  const session = new Session({ cwd: '/tmp', silent: true });
  const models = [{ id: 'noop-1' }];
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'test-fixture',
      version: '0.0.0',
      providers: [
        defineProvider({
          name: 'noop',
          models,
          createClient: () => ({
            name: 'noop',
            models,
            stream: async function* () {},
            countTokens: async () => 0,
          }),
        }),
      ],
      modes: [
        defineMode({
          name: 'marker',
          run: async function* (ctx: ModeContext): AsyncIterable<MoxxyEvent> {
            await ctx.emit({
              type: 'assistant_message',
              sessionId: ctx.sessionId,
              turnId: ctx.turnId,
              source: 'assistant',
              text: 'ok',
            });
          },
        }),
      ],
    }),
  );
  session.providers.setActive('noop');
  session.modes.setActive('marker');
  return session;
}

const handles: ChannelHandle[] = [];
afterEach(async () => {
  while (handles.length) await handles.pop()!.stop();
});

async function startChannel() {
  const channel = new VirtualOfficeChannel(
    { port: 0, token: 'test-token-1234567890' },
    { cwd: '/tmp' },
  );
  const handle = await channel.start({ session: buildPrimary() });
  handles.push(handle);
  return { channel, handle };
}

describe('VirtualOfficeChannel', () => {
  it('refuses a registry-less (remote) session with an actionable error', async () => {
    const channel = new VirtualOfficeChannel({ port: 0, token: 't' }, { cwd: '/tmp' });
    const remoteish = { id: 'x', cwd: '/tmp', log: { subscribe: () => () => {} } };
    await expect(
      channel.start({ session: remoteish as unknown as SessionLike } as never),
    ).rejects.toThrow(/--standalone/);
  });

  it('serves the game only with the token and exposes /config the same way', async () => {
    const { channel } = await startChannel();
    const base = channel.url.split('/?')[0]!;

    const noToken = await fetch(`${base}/`);
    expect(noToken.status).toBe(401);
    const withToken = await fetch(channel.url);
    expect(withToken.status).toBe(200);
    expect(await withToken.text()).toContain('moxxy virtual office');

    const cfgDenied = await fetch(`${base}/config`);
    expect(cfgDenied.status).toBe(401);
    const cfg = await fetch(`${base}/config?t=test-token-1234567890`);
    expect(cfg.status).toBe(200);
    const body = (await cfg.json()) as { wsUrl: string };
    expect(body.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    // The advertised bridge port is real (not the never-bound default).
    expect(body.wsUrl.endsWith(':4091')).toBe(false);

    const health = await fetch(`${base}/v1/health`);
    expect(health.status).toBe(200);
  });

  it('denies tool calls through the channel resolver before start', async () => {
    const channel = new VirtualOfficeChannel({ port: 0, token: 't' }, { cwd: '/tmp' });
    await expect(
      channel.permissionResolver.check({ name: 'wave', input: {} } as never, {} as never),
    ).resolves.toEqual({ mode: 'deny' });
  });
});
