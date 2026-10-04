import type { BrowserProfile } from '../profile-lock.js';
import type { SidecarBrowser } from './sidecar-browser.js';
import type { PlaywrightHandle } from './types.js';

/**
 * The sidecar's mutable state, in a leaf module the dispatch table and its
 * tests share.
 */

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
   * The agent's tabs, driven by the same browser host as the desktop's pane.
   * Made on the first agent call; optional so `{ handle, pendingInstallNotice }`
   * stays a valid state.
   */
  browser?: SidecarBrowser;
  /** Where the browser keeps sign-ins between runs; without one it starts signed out every time. */
  profile?: BrowserProfile;
}
