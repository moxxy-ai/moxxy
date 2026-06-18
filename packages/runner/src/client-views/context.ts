import type { SessionInfo } from '@moxxy/sdk';
import type { JsonRpcPeer } from '../jsonrpc.js';

/**
 * The slice of {@link RemoteSession} state a client-view factory needs.
 *
 * Each `makeXView()` used to be a private method closing over `this` so it could
 * reach the JSON-RPC peer, the attach-time `info` mirror, and the protocol-gate
 * helper. The views are otherwise self-contained per surface, so we lift them
 * into sibling modules under `client-views/` and hand them exactly this context
 * instead of the whole class — behaviour-identical, just no longer crammed into
 * one 600-line god-class.
 */
export interface ViewContext {
  /** The bidirectional JSON-RPC peer backing every RPC-driven mutation/read. */
  readonly peer: JsonRpcPeer;
  /**
   * The last attach/`info.changed` snapshot, or null before attach. Views that
   * read it lazily (transcribers/synthesizers) want the live value, so this is
   * a getter rather than a captured value.
   */
  readonly info: () => SessionInfo | null;
  /**
   * The attach `info` snapshot, throwing if not attached yet — the same guard
   * the class used via `this.requireInfo()`.
   */
  readonly requireInfo: () => SessionInfo;
  /**
   * Guard a method that only exists on a server at/after `minVersion`; throws a
   * clear, actionable error when the attached runner is older. Mirrors the
   * class's `requireServerProtocol`.
   */
  readonly requireServerProtocol: (minVersion: number, feature: string) => void;
}
