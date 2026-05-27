import { defineTunnelProvider } from '@moxxy/sdk';

/**
 * The default tunnel provider: no tunnel at all, just the local URL. Used when
 * the surface and the user share a machine (TUI), or when no real tunnel
 * (cloudflared) is configured/installed.
 */
export const localhostTunnel = defineTunnelProvider({
  name: 'localhost',
  open: (opts) =>
    Promise.resolve({
      url: `http://${opts.host}:${opts.port}`,
      close: () => Promise.resolve(),
    }),
  isAvailable: () => Promise.resolve(true),
});
