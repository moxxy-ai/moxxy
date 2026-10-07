/**
 * The page host on its own, as `@moxxy/plugin-browser/host`: what a process
 * that owns the browser view (the desktop main) needs to answer the agent's
 * browser tools. The package root also builds the plugin — its tools, the
 * `/browser` command and the Playwright loader behind them — and a desktop
 * hot-update has no `node_modules` to load Playwright from.
 */

export {
  BrowserHost,
  BROWSER_PARTITION,
  type HostReply,
  type HostWebContents,
  type PointAction,
  type PointParams,
  type Region,
  type WebContentsLookup,
} from './page/host.js';
export { dispatchToHost, type HostDispatchOptions } from './page/dispatch.js';
