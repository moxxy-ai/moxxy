/**
 * `@moxxy/e2e` — the end-to-end secure channel for the proxy tunnel.
 *
 * This `.` entry is **pure JS with no Node built-ins**, so it bundles under
 * Metro/React Native. Key persistence (which needs the filesystem) lives in the
 * separate `@moxxy/e2e/node` entry.
 */
export {
  generateIdentity,
  publicKeyFromSecret,
  fingerprint,
  publicKeyFromFingerprint,
  deriveUuid,
  sign,
  verify,
  UUID_LABEL_LENGTH,
  type Identity,
} from './identity.js';

export {
  startInitiator,
  respond,
  finishInitiator,
  CLIENT_HELLO_LEN,
  SERVER_HELLO_LEN,
  type SessionKeys,
  type InitiatorState,
} from './handshake.js';

export { FrameSealer, FrameOpener } from './frame.js';

export {
  connectInitiator,
  connectResponder,
  type SecureChannel,
  type MessageTransport,
} from './channel.js';

export {
  base64urlEncode,
  base64urlDecode,
  base32Encode,
  constantTimeEqual,
  utf8,
  utf8Decode,
} from './bytes.js';
