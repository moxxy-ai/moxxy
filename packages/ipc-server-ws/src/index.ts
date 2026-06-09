/**
 * Serve the moxxy IPC contract over an authenticated WebSocket.
 *
 * Typical wiring (in the desktop main, behind a flag):
 *
 *   const wsBus = new WebSocketCommandBus();
 *   registerIpcHandlers([electronBus, wsBus], pool, desks, { update });
 *   wsEventBus.addSink(wsBus);              // events fan out to WS clients
 *   const server = await startWsBridge(wsBus, { port, authToken });
 *   // …on quit: await server.close();
 */

import type { TransportServer } from '@moxxy/runner';
import {
  createWebSocketTransportServer,
  type WebSocketBridgeOptions,
} from './ws-transport.js';
import type { WebSocketCommandBus } from './ws-command-bus.js';

export { createWebSocketTransportServer, type WebSocketBridgeOptions } from './ws-transport.js';
export { WebSocketCommandBus } from './ws-command-bus.js';
export { checkWsAuth } from './auth.js';

/**
 * Convenience: create the transport server and route every accepted connection
 * into `bus.attach`. The caller still registers handlers onto `bus` (via
 * `registerIpcHandlers`) and adds it as an event sink.
 */
export async function startWsBridge(
  bus: WebSocketCommandBus,
  opts: WebSocketBridgeOptions,
): Promise<TransportServer> {
  const server = await createWebSocketTransportServer(opts);
  server.onConnection((transport) => bus.attach(transport));
  return server;
}
