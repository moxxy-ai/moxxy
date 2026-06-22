/**
 * `@moxxy/plugin-tunnel-proxy` — the self-hosted `proxy` tunnel provider.
 *
 * Registers the `proxy` provider so registry-driven channels (the web/preview
 * channel) can activate it. The mobile channel imports {@link proxyTunnel} /
 * {@link createProxyTunnel} directly, mirroring how it used to import the
 * cloudflared/ngrok providers.
 */
import { definePlugin, type Plugin } from '@moxxy/sdk';
import { proxyTunnel } from './provider.js';

export {
  createProxyTunnel,
  proxyTunnel,
  type ProxyTunnelOptions,
  type ProxyLogger,
} from './provider.js';

export {
  PROXY_PROTOCOL_VERSION,
  DEFAULT_PROXY_HOST,
  relayControlHost,
  publicUrl,
  type ControlServerMsg,
  type ControlClientMsg,
  type DataAttachMsg,
} from './protocol.js';

/** The plugin: contributes the `proxy` tunnel provider for auto-discovery. */
export const proxyTunnelPlugin: Plugin = definePlugin({
  name: '@moxxy/plugin-tunnel-proxy',
  version: '0.0.0',
  tunnelProviders: [proxyTunnel],
});
