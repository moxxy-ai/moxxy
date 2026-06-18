/**
 * Public surface of the desktop main-process host. The @moxxy/desktop
 * app's thin `electron/main/index.ts` entry wires these together; the
 * rest of the host (stores, the IPC handler bodies, the runner internals)
 * stays encapsulated behind this barrel.
 */

export { RunnerPool, UNBOUND_ID } from './runner-pool.js';
export { bindWindow, registerIpcHandlers } from './ipc.js';
export { type MobileGatewayController } from './ipc/mobile-gateway.js';
export { sendEvent } from './send-event.js';
export { ElectronCommandBus } from './bus/electron-bus.js';
export { EventBus, wsEventBus } from './event-bus.js';
export { type UpdateConfig } from './ipc/update.js';
export { preferredCliEntry } from './cli-resolver.js';
export { activateManagedNode } from './node-manager.js';
export { ensureDesktopVaultKey } from './vault-key.js';
export { DeskStore } from './desks.js';
export { readPrefs, updatePrefs } from './prefs.js';
export { sweepStaleSockets } from './sweep-sockets.js';
export {
  bindMainWindowMinimize,
  closeFocusWindow,
  resizeFocusWindow,
  showFocusWindow,
  toggleFocusWindow,
  isFocusOpen,
} from './focus-window.js';
export {
  installContentSecurityPolicy,
  installMediaPermissions,
  lockDownNavigation,
  isSafeExternalUrl,
  clerkFrontendApiHost,
  clerkCspHostSources,
  clerkAccountPortalHost,
  installAccountPortalRecovery,
} from './security.js';
export {
  startLoopbackServer,
  DEFAULT_LOOPBACK_PORTS,
  type LoopbackServer,
  type LoopbackServerOptions,
} from './loopback-server.js';
export { installAppAssetProtocol, APP_ASSET_SCHEME } from './apps/assets-protocol.js';
export {
  DESKTOP_APP_HOST,
  generateSelfSignedCert,
  loadOrCreateSelfSignedCert,
  isTrustedLoopbackCert,
  isTrustedLoopbackCertByHost,
  type SelfSignedCert,
} from './self-signed-cert.js';
