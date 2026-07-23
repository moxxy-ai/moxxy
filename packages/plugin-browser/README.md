# @moxxy/plugin-browser

Web access for moxxy in three tiers:

- `web_search` is a local fallback marked with `hosted: { type: 'web_search' }`. A capable provider replaces it with its server-side search; other providers execute the configured adapter.
- `web_fetch` safely reads a public HTTP(S) URL with SSRF checks, DNS pinning, redirect validation, byte limits, and abort handling.
- `browser_session` drives a Playwright sidecar for interactive or JavaScript-heavy pages.

Codex and the Anthropic API provider advertise hosted web search directly using their normal moxxy OAuth/API credentials. The `claude-code` provider uses the installed Claude CLI and enables only its native `WebSearch` tool in text mode by default. Install this plugin when a local fallback, direct page fetches, or an interactive browser is desired.

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
