import { definePlugin } from '@moxxy/sdk';
import { webFetchTool } from './web-fetch.js';
import { buildWebSearchTool, type BuildWebSearchToolOptions } from './web-search.js';
import { buildBrowserSessionTool, closeBrowserSidecar, type BrowserSessionDeps } from './browser-session.js';
import { buildBrowserSurface } from './browser-surface.js';
import { injectNativeBrowserRouting } from './browser-routing.js';

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
  type BrowserSessionDeps,
  type BrowserSessionAction,
  type NativeBrowserBridgeClient,
  type SidecarStream,
} from './browser-session.js';
export { createNativeBrowserBridgeClient } from './native-browser-client.js';
export { browserSessionActionSchema, browserTargetSchema } from './browser-action.js';
export {
  buildBrowserObservationScript,
  buildBrowserRefPointScript,
  buildBrowserRefValidationScript,
  buildBrowserSelectorPointScript,
  formatBrowserObservationForModel,
  parseBrowserObservation,
  type BrowserObservation,
  type BrowserObservationTarget,
  type ParsedBrowserObservation,
} from './browser-observation.js';
export { injectNativeBrowserRouting } from './browser-routing.js';
export { buildBrowserSurface } from './browser-surface.js';
export {
  assertPublicUrl,
  isBlockedIp,
  SsrfBlockedError,
  type DnsResolver,
} from './ssrf-guard.js';

export interface BuildBrowserPluginOptions extends BrowserSessionDeps {
  readonly webSearch?: BuildWebSearchToolOptions;
}

export function buildBrowserPlugin(opts: BuildBrowserPluginOptions = {}) {
  return definePlugin({
    name: '@moxxy/plugin-browser',
    version: '0.0.0',
    tools: [buildWebSearchTool(opts.webSearch), webFetchTool, buildBrowserSessionTool(opts)],
    surfaces: [buildBrowserSurface(opts)],
    hooks: {
      onBeforeProviderCall: (request, context) =>
        injectNativeBrowserRouting(request, context.env),
      onShutdown: async () => {
        // Make sure the sidecar process exits with the session.
        await closeBrowserSidecar();
      },
    },
  });
}

export const browserPlugin = buildBrowserPlugin();

export default browserPlugin;
