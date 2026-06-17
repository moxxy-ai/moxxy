/**
 * Tunnel support for the webhooks listener — exposes the local HTTP listener
 * publicly through the self-hosted **proxy** relay (cloudflared/ngrok were
 * removed). The listener is registered under the `webhook` path target, so it
 * shares the agent's single `uuid.<host>` subdomain with the mobile bridge and
 * web preview.
 */
import { proxyTunnel } from '@moxxy/plugin-tunnel-proxy';
import type { TunnelHandle, TunnelProviderDef } from '@moxxy/sdk';

/** Path segment the webhook listener is exposed under on the relay. */
export const WEBHOOK_TUNNEL_LABEL = 'webhook';

export interface RunningTunnel {
  /** Public base URL the external system POSTs to (`https://<uuid>.<host>/webhook`). */
  readonly url: string;
  /** Tear the tunnel down (deregisters the target). */
  readonly stop: () => Promise<void>;
}

export interface TunnelStartOptions {
  readonly port: number;
  readonly host?: string;
}

/**
 * Open a public tunnel to the local webhook listener via the proxy relay.
 * `provider` is injectable for tests; production uses the shared `proxyTunnel`.
 */
export async function startTunnel(
  opts: TunnelStartOptions,
  provider: TunnelProviderDef = proxyTunnel,
): Promise<RunningTunnel> {
  const handle: TunnelHandle = await provider.open({
    port: opts.port,
    host: opts.host ?? '127.0.0.1',
    label: WEBHOOK_TUNNEL_LABEL,
  });
  return { url: handle.url, stop: () => handle.close() };
}
