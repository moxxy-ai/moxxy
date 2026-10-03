import { definePlugin } from '@moxxy/sdk';
import { webFetchTool } from './web-fetch.js';
import { buildWebSearchTool, type BuildWebSearchToolOptions } from './web-search.js';
import { buildBrowserSessionTool, closeBrowserSidecar, type BrowserSessionDeps } from './browser-session.js';
import { buildAgentTools } from './agent-tools.js';
import { buildBrowserSurface } from './browser-surface.js';
import { bridgeAddressFromEnv } from './bridge-client.js';
import { JevAccess, withBrowserRunGuidance } from './run/run-tool.js';

export { webFetchTool, htmlToPlainText, htmlToMarkdown } from './web-fetch.js';
export {
  buildWebSearchTool,
  duckDuckGoHtmlAdapter,
  parseDuckDuckGoHtml,
  type BuildWebSearchToolOptions,
  type WebSearchAdapter,
  type WebSearchQuery,
  type WebSearchResult,
} from './web-search.js';
export {
  buildBrowserSessionTool,
  browserSidecarCall,
  closeBrowserSidecar,
  activeBrowserBackend,
  resetBrowserBackendForTests,
  type BrowserSessionDeps,
  type SidecarStream,
} from './browser-session.js';
export { buildBrowserSurface } from './browser-surface.js';
export { buildAgentTools } from './agent-tools.js';
export {
  ALLOW_SITE_TOOL,
  siteAllows,
  siteGrantSchema,
  siteOf,
  siteRefusal,
  sitesFromLog,
  type SiteGrant,
} from './site-access.js';
export {
  BridgeClient,
  bridgeAddressFromEnv,
  BRIDGE_SOCKET_ENV,
  BRIDGE_TOKEN_ENV,
  type BridgeAddress,
} from './bridge-client.js';
export { buildAxTree, newUidMemory, type AxNode, type AxNodeRaw, type AxTree, type UidMemory } from './ax/tree.js';
export { formatAxTree, MAX_LABEL_CHARS, MAX_TREE_DEPTH } from './ax/format.js';
export { appTreeOf } from './ax/app-tree.js';
export { JevAccess, RUN_TOOL, buildRunTool, withBrowserRunGuidance, type RunToolOptions } from './run/run-tool.js';
export { formatRunReport, runBrowserSteps, runStepSchema, type PageRead, type RunPort, type RunReport, type RunStep } from './run/browser-run.js';
export { diffRendering, renderingFromText, renderingOf } from './ax/diff.js';
export { formatSnapshot, redactSecretValues, UNTRUSTED_NOTE, type TabInfo } from './ax/snapshot.js';
export { detectWall, wallNote, type Wall, type WallKind } from './ax/wall.js';

export interface BuildBrowserPluginOptions extends BrowserSessionDeps {
  readonly webSearch?: BuildWebSearchToolOptions;
}

export function buildBrowserPlugin(opts: BuildBrowserPluginOptions = {}) {
  const jev = new JevAccess();
  return definePlugin({
    name: '@moxxy/plugin-browser',
    version: '0.0.0',
    tools: [
      buildWebSearchTool(opts.webSearch),
      webFetchTool,
      // Accessibility-first perception + uid-addressed action, over named tabs.
      // This is the path the agent should take; `browser_session` stays below
      // it as the escape hatch for CSS selectors and in-page `eval`.
      ...buildAgentTools(opts, { run: { access: jev } }),
      buildBrowserSessionTool(opts),
    ],
    // The polling frame surface exists for hosts that have no browser of their
    // own. Inside the desktop the page IS the pane — a real Chromium view the
    // window composites — so registering this too would launch a SECOND
    // browser and stream pictures of it that nobody looks at.
    surfaces: bridgeAddressFromEnv() ? [] : [buildBrowserSurface(opts)],
    hooks: {
      onBeforeProviderCall: withBrowserRunGuidance(jev),
      onShutdown: async () => {
        // Make sure the sidecar process exits with the session.
        await closeBrowserSidecar();
      },
    },
  });
}

export const browserPlugin = buildBrowserPlugin();

export default browserPlugin;
