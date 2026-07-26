# @moxxy/plugin-browser

Web access for moxxy in three tiers:

- `web_search` is a local fallback marked with `hosted: { type: 'web_search' }`. A capable provider replaces it with its server-side search; other providers execute the configured adapter.
- `web_fetch` safely reads a public HTTP(S) URL with SSRF checks, DNS pinning, redirect validation, byte limits, and abort handling.
- `browser_session` drives the live Moxxy Browser tab in Desktop and a
  Playwright sidecar elsewhere. Desktop users and the agent therefore share the
  same tabs, cookies, navigation, and signed-in session.

Codex and the Anthropic API provider advertise hosted web search directly using their normal moxxy OAuth/API credentials. The `claude-code` provider uses the installed Claude CLI and enables only its native `WebSearch` tool in text mode by default. Those three provider packages install this plugin automatically, so the local adapter is ready when a provider participating in Moxxy tool calling needs it. Other providers can install it separately.

The automatic install stays lightweight: Playwright is an optional peer with no install hook. Its package and browser engine are offered only when `browser_session` is used.

## Computer-use contract

Interactive work starts with `observe`. A semantic observation returns bounded
visible text and accessible controls with revision-bound refs. The agent can
click, type, press keys, hover, scroll, drag, select options, upload explicitly
scoped files, wait for page state, and manage tabs/history. Canvas-heavy pages
use viewport-relative coordinates and a visual or hybrid observation; Desktop
captures only the browser viewport, never the whole screen.

Every action is validated at the runner-to-Electron boundary. Native navigation
keeps the existing public-http(s) SSRF policy, uploads accept absolute regular
files only, and stale refs fail closed. The Browser pane exposes active agent
control and a Stop action. Consequential page actions still pass through the
normal Moxxy permission flow and must be verified with a fresh observation.

## Custom search adapter

```ts
import { buildBrowserPlugin, type WebSearchAdapter } from '@moxxy/plugin-browser';

const adapter: WebSearchAdapter = {
  name: 'internal-search',
  async search({ query, maxResults }, ctx) {
    // Honor ctx.signal and return at most maxResults source records.
    return [{ title: query, url: 'https://example.com/' }].slice(0, maxResults);
  },
};

export default buildBrowserPlugin({ webSearch: { adapter } });
```

The default fallback adapter uses DuckDuckGo's HTML endpoint through the same hardened fetch path as `web_fetch`.
