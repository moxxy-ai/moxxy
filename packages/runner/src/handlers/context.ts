import type { Session } from '@moxxy/core';
import type { Mutex } from '@moxxy/sdk';

/**
 * The slice of {@link RunnerServer} state a per-domain handler needs.
 *
 * Each `handleX` used to be a private method on the 757-line server, closing
 * over `this.session`, the prefs mutex, and `this.broadcastInfo()`. The handlers
 * are otherwise independent per domain (providers / media / MCP / workflows /
 * surfaces / session-ops), so we lift their bodies into sibling modules under
 * `handlers/` and hand them exactly this context. The server keeps the dispatch
 * wiring + turn/attach/resolver logic and delegates each method here —
 * behaviour-identical, just no longer one monolith.
 */
export interface HandlerContext {
  /** The Session the runner owns and serves to attached clients. */
  readonly session: Session;
  /**
   * Serializes this runner's preferences read-modify-write handlers
   * (provider setActive / setEnabled) so two overlapping writes can't both read
   * the same set and clobber each other (invariant #5).
   */
  readonly prefsMutex: Mutex;
  /** Push the fresh registry snapshot to every attached client. */
  readonly broadcastInfo: () => void;
}
