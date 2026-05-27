---
name: build-app
description: Build a navigable web app/platform for the user (e.g. "build me a search engine for X") with present_view + the JSX-like view-spec, backed by REAL data from your tools. Only for explicit build requests, not ordinary searches.
triggers: ["build me", "build a platform", "build a search engine", "build an app", "build a website", "build a dashboard", "make me a", "create a tool for", "build me a tool", "make a platform"]
allowed-tools: [present_view, web_fetch, browser_session]
---

# Build an app

Build an interactive, navigable web app, backed by **real data**, and hand the user a
link to it.

## When to use this — and when NOT to

**Use `present_view` ONLY when the user explicitly asks you to *build* / *make* /
*create* a UI, app, platform, search engine, website, or dashboard.**

- ✅ "build me a search engine for arXiv papers", "build me a flight search WAW→KRK".
- ❌ "search flights SFO→JFK", "find me papers on transformers" → **answer in plain
  text. Do NOT build a UI.** Ordinary searches/questions are handled as you always have.

## Use REAL data — never demo data

The app must show **real results fetched from real sources**, not placeholders you made
up. Get data with your tools — `web_fetch` (JSON APIs, public endpoints, HTML pages),
`browser_session` (JS-heavy sites), or any MCP/provider tool available. **Never fabricate
results, prices, IDs, or links.** If you can't find a usable data source, render a clear
message saying so (a `card` with `text tone="warn"`) instead of inventing data.

## Render upfront — don't make the user re-ask

If the user already gave you the parameters (e.g. "flights WAW→KRK"), **go straight to
results in the same turn** — don't show an empty form and wait for them to submit what
they already told you. Build the populated app now.

## The loader-first flow (every fetch)

A `present_view` call flushes to the browser immediately, so within ONE turn:

1. `present_view` a **loading** screen (skeleton/spinner) under a screen `name`.
2. Fetch the **real** data with your tools.
3. `present_view` the **results** under the **same `name`** — it replaces the skeleton.

Use the same `name` for the loading and loaded states so the result swaps the skeleton
in place (don't leave a dangling "loading" screen).

### Example: "build me a flight search for WAW → KRK" (params given → render upfront)

Turn 1, call 1 — show the loading state instantly:

```xml
<view name="results" title="WAW → KRK">
  <text tone="muted">Searching live flights…</text>
  <skeleton rows="5" />
</view>
```

Then fetch real data (`web_fetch` a flights API / source). Turn 1, call 2 — replace with
real results:

```xml
<view name="results" title="WAW → KRK · 4 flights">
  <results>
    <result title="LOT LO3923" subtitle="06:40 → 07:55 · nonstop" badge="PLN 320" action="open:LO3923" />
    <result title="Ryanair FR2118" subtitle="20:10 → 21:25 · nonstop" badge="PLN 149" action="open:FR2118" />
  </results>
  <link to="search">↻ Refine search</link>
</view>
```

Also build a `search` screen (a `form action="run_search"` with from/to/date inputs,
pre-filled) so the user can refine; on submit you repeat the loader-first flow.

## The app model

Multiple named screens the user navigates between (one `present_view` per screen):

- **`to="<screenName>"`** on a `link`/`button` → jump to that screen **instantly,
  client-side, no turn** (if you've already built it).
- **`action="…"`** on a form/button → an **agent turn** back to you (search, open a
  record). Fetch real data, then render the next screen.
- A built-in **Back** button returns to previous screens for free.

Clicking a result sends `[ui-action] {"action":"open:LO3923"}` → fetch that record's real
details → build a `detail:LO3923` screen with `<link to="results">← Back</link>`.

## Vocabulary (allow-listed — unknown tags/attrs are rejected)

**Layout:** `view`(name?,title?) · `stack`(gap?,align?) · `row`(gap?,align?,justify?) ·
`grid`(cols 1-6) · `card`(title?,accent?) · `divider`.
**Loading:** `spinner`(label?) · `skeleton`(rows 1-12).
**Display:** `heading`(level 1-3) · `text`(tone?,weight?) · `badge`(tone?) ·
`image`(src,alt?) · `link`(href? OR to?) · `list`(ordered?)/`item` · `table`/`tr`/`th`/`td`.
**Inputs (in a `form`):** `form`(action,submit?) · `input`(name,type?,label?,placeholder?,value?,required?) ·
`select`(name,…)/`option`(value) · `checkbox`(name,label?) ·
`button`(label, **action** OR **to**, variant?, fields?).
**Component:** `results` → `result`(title, subtitle?, badge?, id?, action? | to?).

## Rules

- One `<view>` root per call; give each screen a `name`; loading + loaded share the name.
- `to=` navigates between your screens; `action=` only for work you must do (fetch).
- Allow-listed tags/attrs only. `href`/`src` must be `https:`/`mailto:`/relative.
  Enums: `card accent` & `text/badge tone` ∈ `default|muted|success|warn|danger`;
  `gap` ∈ `none|sm|md|lg`.
- **Share the EXACT `url` from the present_view result.** Never invent a path like
  `/app/search`. If the result is `rendered:false` or has no `url`, the surface isn't
  running — say so instead of guessing a link.
- Always pass `fallbackText` (a one-line summary).
