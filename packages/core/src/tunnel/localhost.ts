import { defineTunnelProvider } from '@moxxy/sdk';

/**
 * The default tunnel provider: no tunnel at all, just the local URL. Used when
 * the surface and the user share a machine (TUI), or when no real tunnel
 * (the proxy relay) is configured.
 */
export const localhostTunnel = defineTunnelProvider({
  name: 'localhost',
  open: (opts) => {
    // Bracket an IPv6 literal host (e.g. `::1` → `[::1]`) so the `:port`
    // delimiter is unambiguous and the result is a valid URL. A bare IPv6
    // host (`http://::1:4040`) is rejected by most URL parsers.
    const host = opts.host.includes(':') ? `[${opts.host}]` : opts.host;
    return Promise.resolve({
      url: `http://${host}:${opts.port}`,
      close: () => Promise.resolve(),
    });
  },
  isAvailable: () => Promise.resolve(true),
});
