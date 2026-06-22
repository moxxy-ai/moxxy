import { describe, expect, it } from 'vitest';
import type { TunnelOpenOptions, TunnelProviderDef } from '@moxxy/sdk';
import { startTunnel, WEBHOOK_TUNNEL_LABEL } from './tunnel.js';

describe('startTunnel', () => {
  it('exposes the listener via the proxy provider under the webhook label', async () => {
    let opened: TunnelOpenOptions | null = null;
    const fake: TunnelProviderDef = {
      name: 'proxy',
      open: (o) => {
        opened = o;
        return Promise.resolve({
          url: 'https://uuid.proxy.test/webhook',
          close: () => Promise.resolve(),
        });
      },
    };

    const tunnel = await startTunnel({ port: 8088 }, fake);

    expect(opened).toEqual({ port: 8088, host: '127.0.0.1', label: WEBHOOK_TUNNEL_LABEL });
    expect(tunnel.url).toBe('https://uuid.proxy.test/webhook');
    await tunnel.stop();
  });
});
