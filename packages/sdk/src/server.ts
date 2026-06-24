/**
 * Node-runtime-only surface of @moxxy/sdk.
 *
 * Importing `@moxxy/sdk/server` pulls in the value helpers that statically
 * depend on Node builtins (`node:child_process`, `node:fs`, `node:os`,
 * `node:http`, `node:crypto`, `node:path`). The MAIN barrel (`@moxxy/sdk`) is
 * deliberately kept free of these so a browser/React-Native bundle can value-
 * import from it (and from `@moxxy/sdk/tool-display`) without dragging a Node
 * builtin into the bundle — Metro cannot polyfill `node:child_process`.
 *
 * Node-side consumers (cli, runner, desktop-host, channel/oauth/webhooks
 * plugins, …) import these helpers from here. The corresponding *type* exports
 * (e.g. `TunnelHandle`, `WriteFileAtomicOptions`, `ChannelTokenOptions`) remain
 * on the main barrel because types are erased at build time and never reach a
 * bundle.
 */

export {
  writeFileAtomic,
  writeFileAtomicSync,
  moxxyHome,
  moxxyPath,
} from './fs-utils.js';
// Cross-process "fire exactly once" lock (node:fs). Value lives here; its
// options type is re-exported from the main barrel like other erased types.
export { CrossProcessFireLock } from './cross-process-lock.js';
export { readRequestBody, bearerTokenMatches } from './http-utils.js';
export {
  resolveChannelToken,
  rotateChannelToken,
  bearerGuard,
  encodeWsBearerProtocol,
  tokenFromWsProtocolHeader,
  MOXXY_WS_SUBPROTOCOL,
  MOXXY_WS_BEARER_PROTOCOL_PREFIX,
} from './channel-auth.js';
