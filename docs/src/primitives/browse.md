# Browse & Browser Primitives

Moxxy provides two complementary surfaces for working with the web:

- **`browse.*`** — fast HTTP-only primitives for plain pages and offline HTML parsing.
- **`browser.*`** — a full headless Chromium driven by a Playwright sidecar, for
  JS-rendered pages, interaction (clicks, forms, screenshots) and crawling.

Use `browse.*` whenever a page works without JavaScript — it's an order of
magnitude cheaper. Reach for `browser.*` only when the fast path returns empty
or partial content.

## browse.fetch

HTTP fetch with browser-like headers. Returns clean readability-style text plus
extracted links and an optional CSS-selected slice. **No JS execution.**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | URL to fetch |
| `selector` | string | no | CSS selector to also return as `selected_text` |
| `include_html` | bool | no | Return raw HTML alongside the cleaned text |

Returns `{ status, url, body_length, text, links, title?, selected_text?, body? }`.
Domain allowlist enforced; size cap 10 MB; timeout 30 s.

## browse.extract

Pure offline CSS extraction. Takes raw HTML and a `{ field: selector }` map.
Returns `{ data: { field: text|[texts] } }`. No network access.

## browser.* (Playwright sidecar)

The first call into any `browser.*` primitive triggers a one-time bootstrap:
moxxy downloads Node.js, `playwright-core`, and Chromium into `~/.moxxy/runtimes/`
and `~/.moxxy/sidecars/playwright/` (about 250 MB total). Subsequent calls reuse
the install.

The sidecar is one Node child process **per agent**, supervised by `BrowserManager`:

- Lazy spawn on first call.
- Idle-killed after 5 minutes of inactivity (next call respawns).
- Auto-restart on crash; in-flight calls receive a transient error.
- Per-call timeout clamped to `[1 s, 120 s]`.
- HTML reads capped at 4 MiB; in-band screenshots capped at 8 MiB.

### Sessions and pages

A **session** is an isolated `BrowserContext` (cookie/storage jar). A **page** is
a tab inside a session. Both are referenced by ids returned to the agent:

```
browser.session.open                    → { session_id }
browser.navigate { session_id, url }    → { page_id, status, final_url }
browser.read    { page_id }             → { title, text, links, ... }
browser.session.close { session_id }
```

Open exactly one session per logical task and close it when done.

### Primitives

| Primitive | Purpose |
|-----------|---------|
| `browser.session.open` | Create a session with optional viewport, locale, user agent. |
| `browser.session.close` | Close a session and its pages. |
| `browser.session.list` | Enumerate active sessions. |
| `browser.navigate` | Open a URL. Reuses `page_id` if supplied. Allowlisted. |
| `browser.read` | Get rendered content in `markdown` (default), `text`, or `html` mode. |
| `browser.extract` | CSS extraction on the live DOM. |
| `browser.screenshot` | PNG/JPEG of viewport, full page, or a single element. Pass `save_to` to write into the workspace. |
| `browser.click` | Auto-waiting click. |
| `browser.type` | Keystroke-by-keystroke text entry. |
| `browser.fill` | One-shot value set on inputs/selects. |
| `browser.hover` | Hover an element. |
| `browser.scroll` | Scroll to top/bottom/coords or scroll an element into view. |
| `browser.wait` | Wait for selector state, load state, or fixed delay. |
| `browser.eval` | Run a JS expression in page context. **Powerful — opt in only.** |
| `browser.cookies` | get / set / clear cookies on the session. |
| `browser.crawl` | BFS multi-page crawl using one ephemeral session. Default depth 1, pages 5. Hard caps depth 10, pages 200. |

### Domain allowlist

`browser.navigate` and `browser.crawl` enforce the per-agent `http_domain`
allowlist before any navigation happens. Disallowed targets return:

```json
{
  "status": "domain_not_allowed",
  "domain": "example.com",
  "url": "https://example.com/...",
  "action_required": "Domain '...' is not in the allowlist. Use `user.ask` ..."
}
```

The agent should ask the user, then call `allowlist.add` before retrying.

### Bootstrap troubleshooting

The bootstrap downloads Node from `nodejs.org/dist`, verifies the SHA256
against the published `SHASUMS256.txt`, then runs `npm install` and
`playwright install chromium` inside `~/.moxxy/sidecars/playwright/`. To force
a fresh install, delete `~/.moxxy/sidecars/playwright/.installed-v1` (the
marker file) and the next browser primitive call will re-bootstrap.

If your machine already has Node ≥ 18 on `PATH`, moxxy will use it instead of
downloading its own. Set `NODE_PATH=/path/to/node` to point at a specific
binary.
