/**
 * Mobile-gateway IPC handlers (status / setEnabled / rotateToken).
 *
 * The handler bodies are thin: the actual bridge lifecycle (the lazily-imported
 * `@moxxy/ipc-server-ws` server, its bound port, the persisted pairing token,
 * the LAN-advertised host, and the connectUrl/QR payload) lives in the Electron
 * main, because only the main owns the `WebSocketCommandBus`/server and the
 * Electron `app` + userData paths. The main injects a {@link MobileGatewayController}
 * into `registerIpcHandlers`; these handlers just forward to it.
 *
 * Security: these COMMANDS control the gateway, so they are host-only — listed
 * in `REMOTE_DISALLOWED_COMMANDS`, the WS bus refuses them. A remote client can
 * never toggle the gateway, read the pairing token, or rotate it over the very
 * transport that token guards.
 */

import type { MobileGatewayStatus } from '@moxxy/desktop-ipc-contract';
import { IpcError, handle } from './shared';

/**
 * The bridge-lifecycle surface the main process implements and injects. Kept as
 * an interface (not a concrete class) so desktop-host stays Electron-free and
 * the handlers are unit-testable against a fake.
 */
export interface MobileGatewayController {
  /** Current status (running, advertised host+port, connectUrl, token, client
   *  count). Cheap + synchronous-ish; may do a token read. */
  status(): Promise<MobileGatewayStatus> | MobileGatewayStatus;
  /** Start (true) / stop (false) the bridge and persist the preference. Resolves
   *  with the resulting status. Throws if the bridge can't start (e.g. the WS
   *  module failed to load, or the port is taken). */
  setEnabled(enabled: boolean): Promise<MobileGatewayStatus>;
  /** Rotate the pairing token on the live server (and persist it). Returns the
   *  status carrying the new token + connectUrl. */
  rotateToken(): Promise<MobileGatewayStatus>;
}

export function registerMobileGatewayHandlers(controller: MobileGatewayController | null): void {
  // No controller wired (e.g. a non-Electron embed, or tests that don't need
  // it): report the gateway as unavailable rather than crashing. `not-supported`
  // is the contract's "hide the affordance" signal.
  const must = (): MobileGatewayController => {
    if (!controller) {
      throw new IpcError('not-supported', 'mobile gateway is not available in this host');
    }
    return controller;
  };

  handle('mobileGateway.status', async () => must().status());
  handle('mobileGateway.setEnabled', async ({ enabled }) => {
    try {
      return await must().setEnabled(enabled);
    } catch (e) {
      if (e instanceof IpcError) throw e;
      throw new IpcError(
        'runner-error',
        e instanceof Error ? e.message : 'failed to toggle the mobile gateway',
      );
    }
  });
  handle('mobileGateway.rotateToken', async () => {
    try {
      return await must().rotateToken();
    } catch (e) {
      if (e instanceof IpcError) throw e;
      throw new IpcError(
        'runner-error',
        e instanceof Error ? e.message : 'failed to rotate the pairing token',
      );
    }
  });
}
