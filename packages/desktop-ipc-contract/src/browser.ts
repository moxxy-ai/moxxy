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
