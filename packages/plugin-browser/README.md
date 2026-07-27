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

Providers receive a hand-written JSON Schema with one canonical element target:

```ts
target:
  | { type: 'ref'; ref: string; revision: string }
  | { type: 'selector'; selector: string }
  | { type: 'point'; x: number; y: number }
```

`ref` is preferred because Desktop binds it to the observed frame and backend
DOM node. `point` uses viewport-relative coordinates from 0 to 1000 and is a
fallback for canvas/WebGL applications. The runtime still accepts the former
top-level `selector` and `fill` shapes for compatibility, but providers never
see those legacy fields. Blank optional placeholders are ignored without
changing a deliberately empty value used to clear a text field.

Desktop observations combine the document accessibility tree, open Shadow DOM,
cross-origin frames, and a browser-viewport screenshot when hybrid or visual
mode is requested. Every navigation, DOM change, tab switch, or user input
invalidates old refs. Mutating actions return `verificationRequired: true`; the
agent must observe again instead of assuming the requested state was reached.

The native bridge advertises protocol version 2 in tool capabilities and in its
private authenticated socket handshake. Desktop refuses an old or detached
browser plugin with `Browser plugin update/restart required` instead of silently
opening a second Playwright browser. Development builds explicitly prefer the
workspace plugin over a stale package under `~/.moxxy/plugins`.

Failures use stable codes (`STALE_BROWSER_STATE`, `ELEMENT_NOT_FOUND`,
`ELEMENT_NOT_INTERACTABLE`, `NAVIGATION_BLOCKED`, `BACKEND_MISMATCH`,
`USER_TAKEOVER`, `USER_ABORTED`, and `TIMEOUT`) and tell the model whether to
observe again or stop. Two equivalent failures in one turn open a retry circuit,
preventing repeated blind clicks. User input always wins and cancels work based
on the previous page epoch.

Downloads are visible and cancellable, use collision-free safe filenames, and
never overwrite silently. Popups and OAuth flows become normal Moxxy Browser
tabs in the same persistent partition. Site access to microphone, camera,
location, and clipboard requires an explicit per-origin user decision; the
agent cannot approve it. CAPTCHA, 2FA, payments, and system authentication stay
with the user.

Page text, accessibility labels, and pixels are returned as
`UNTRUSTED_PAGE_DATA`. Password values, cookies, bridge tokens, and credential
attributes are excluded from observations and logs. Set
`MOXXY_BROWSER_DISABLE_EVAL=1` to remove the last-resort page-script action.

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
