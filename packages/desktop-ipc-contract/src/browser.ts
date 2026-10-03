/**
 * One tab of the agent's browser, as the renderer sees it.
 *
 * Deliberately just metadata: the pane renders the page by hosting the view,
 * not by receiving it, so nothing here describes pixels.
 */
export interface BrowserTabInfo {
  readonly tabId: string;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
}

/**
 * Where the agent's pointer is on a tab, in the page's CSS pixels — the view
 * fills the pane, so they are the pane's pixels too. `moving` glides there over
 * `durationMs`; `delivered` and `failed` mark a press where it stands.
 */
export interface BrowserCursor {
  readonly x: number;
  readonly y: number;
  readonly phase: 'moving' | 'delivered' | 'failed';
  readonly durationMs: number;
}

/**
 * Who drives the browser. `user` means the person took it over and the agent's
 * actions are refused until they resume or send a new message. `turnId` is the
 * turn that last used the browser: the pane shows its controls while that turn runs.
 */
export interface BrowserControlState {
  readonly driver: 'agent' | 'user';
  readonly turnId: string | null;
}
