/**
 * `@moxxy/desktop-app-sdk` — the contract for moxxy desktop mini-apps.
 *
 * Host + renderer import this barrel for the manifest schema, the capability
 * list, and the bridge protocol types. Apps import `@moxxy/desktop-app-sdk/client`
 * for the browser-side bridge client (the only DOM-touching entry).
 */

export {
  APP_ID_RE,
  appAssetSchema,
  appInstallSchema,
  appManifestSchema,
  parseAppManifest,
  type AppManifest,
  type AppAssetManifest,
  type ManifestParseOk,
  type ManifestParseError,
} from './manifest.js';

export {
  APP_PERMISSIONS,
  PERMISSION_LABELS,
  isAppPermission,
  type AppPermission,
} from './permissions.js';

export {
  BRIDGE_TAG,
  METHOD_PERMISSION,
  RENDERER_DISPATCHED_METHODS,
  isBridgeRequest,
  isRendererDispatched,
  type BridgeMethod,
  type BridgeMethods,
  type BridgeSpan,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeReady,
  type BridgeInbound,
  type BridgeOutbound,
} from './bridge.js';
