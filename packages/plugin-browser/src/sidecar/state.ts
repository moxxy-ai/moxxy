import type { AxNode } from '../ax/tree.js';
import type { TabRegistry } from './tabs.js';
import type { CdpSession, PlaywrightHandle } from './types.js';

/**
 * The sidecar's mutable state, in a leaf module both `dispatch` and
 * `agent-ops` can import.
 *
 * It lives here rather than beside the dispatch table because the two need it
 * in opposite directions: `dispatch` calls the ops, and the ops need the state
 * shape — which is a cycle if the shape is declared in `dispatch`. The repo
 * forbids circular imports (`pnpm check:deps` fails on them) and the fix it
 * uses elsewhere is exactly this: route the shared contract through a leaf.
 * See `@moxxy/core`'s `session-runtime.ts`, which exists for the same reason.
 */

/** What one tab's last snapshot resolved to, so uids can be replayed. */
export interface TabSnapshot {
  readonly index: ReadonlyMap<string, AxNode>;
  /** The URL at capture time — the cheap staleness check. */
  readonly url: string;
}

export interface SidecarState {
  handle: PlaywrightHandle | null;
  /**
   * Set after a successful auto-install of browser binaries so the next
   * tool result can carry a `notice` letting the user/model know the
   * one-time download happened. Cleared once the notice has been
   * delivered (handed to the reply once, then forgotten).
   */
  pendingInstallNotice: string | null;
  /**
   * Named tabs. Seeded with the launch page on first use and grown by
   * `tabs:new` and by pages the site opens itself. Optional so existing
   * constructors (`{ handle, pendingInstallNotice }`) stay valid.
   */
  tabs?: TabRegistry;
  /** One CDP channel per tab, opened on demand and reused. */
  cdp?: Map<string, CdpSession>;
  /** Last accessibility snapshot per tab, so a uid can be resolved back. */
  snapshots?: Map<string, TabSnapshot>;
}
