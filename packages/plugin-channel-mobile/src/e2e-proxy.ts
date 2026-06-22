/**
 * One-call helper to expose a local mobile WS bridge through the self-hosted
 * `proxy` relay with end-to-end encryption.
 *
 * It loads (or creates) the agent identity, starts the Noise responder shim in
 * front of the loopback bridge, and opens the `proxy` tunnel pointed at the
 * shim — so the relay only ever sees ciphertext and the bearer token never
 * crosses it. The returned handle carries the public URL and the agent
 * fingerprint (for the QR `?fp=`), and tears the tunnel + shim down on close().
 *
 * Shared by the CLI mobile channel and the desktop mobile gateway so the
 * shim+tunnel orchestration lives in exactly one place.
 */
import { fingerprint, type Identity } from '@moxxy/e2e';
import { loadOrCreateIdentity } from '@moxxy/e2e/node';
import { proxyTunnel } from '@moxxy/plugin-tunnel-proxy';
import { startE2EShim, type E2EShimHandle } from './e2e-shim.js';

export interface E2EProxyLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface OpenMobileProxyOptions {
  /** The loopback port the mobile WS bridge is listening on. */
  readonly bridgePort: number;
  /** The host the shim forwards decrypted traffic to (default `127.0.0.1`). */
  readonly bridgeHost?: string;
  /** The pairing bearer token the phone proves (encrypted) to the shim. */
  readonly token: string;
  /** Override the identity key path (defaults to `~/.moxxy/proxy-identity.key`). */
  readonly identityPath?: string;
  readonly logger?: E2EProxyLogger;
}

export interface E2EProxyHandle {
  /** Public URL for the QR / connectUrl (`https://<uuid>.<host>/mobile`). */
  readonly url: string;
  /** Agent public-key fingerprint the phone pins (the QR `?fp=`). */
  readonly fingerprint: string;
  /** Tear down the tunnel and the shim. */
  close(): Promise<void>;
}

/**
 * Open the E2E proxy path for a mobile bridge. Throws if the relay is
 * unreachable (caller decides whether to fall back to a LAN-only URL); the shim
 * is always torn down on a failed tunnel open so no listener leaks.
 */
export async function openMobileProxyTunnel(opts: OpenMobileProxyOptions): Promise<E2EProxyHandle> {
  const identity: Identity = await loadOrCreateIdentity(opts.identityPath);
  const fp = fingerprint(identity.publicKey);
  const shim: E2EShimHandle = await startE2EShim({
    identity,
    token: opts.token,
    bridgePort: opts.bridgePort,
    bridgeHost: opts.bridgeHost ?? '127.0.0.1',
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
  let tunnel;
  try {
    tunnel = await proxyTunnel.open({ port: shim.port, host: '127.0.0.1', label: 'mobile' });
  } catch (err) {
    await shim.close().catch(() => undefined);
    throw err;
  }
  return {
    url: tunnel.url,
    fingerprint: fp,
    close: async () => {
      await tunnel.close().catch(() => undefined);
      await shim.close().catch(() => undefined);
    },
  };
}
