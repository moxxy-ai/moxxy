---
name: build-app
description: Build a navigable web app/platform for the user (e.g. "build me a search engine for X") using present_view and the JSX-like view-spec. Only for explicit build requests, not ordinary searches.
triggers: ["build me", "build a platform", "build a search engine", "build an app", "build a website", "build a dashboard", "make me a", "create a tool for", "build me a tool", "make a platform"]
allowed-tools: [present_view]
---

# Build an app

Build an interactive, navigable web app and hand the user a link to it.

## When to use this — and when NOT to

**Use `present_view` ONLY when the user explicitly asks you to *build* / *make* /
*create* a UI, app, platform, search engine, website, or dashboard.**

- ✅ "build me a search engine for arXiv papers" → build the app (below).
- ✅ "make me a dashboard for my GitHub repos", "build a platform to browse X".
- ❌ "search flights from SFO to JFK", "find me papers on transformers", "what's the
  weather" → **answer normally, in plain text. Do NOT build a UI.** An ordinary search
  or question is handled the way you always have.

If you're unsure, default to a normal text answer. The web app is for when the user
wants a *thing they can use*, not a one-off answer.

## The app model

An app is **multiple named screens** the user navigates between. You author each
screen with a separate `present_view` call; each is `<view name="…">`. The surface
caches screens by name, so:

- **`to="<screenName>"`** on a `link`/`button` → the user jumps to that screen
  **instantly, client-side, with no new turn** (if you've already built it).
- **`action="…"`** on a form/button → sends an **agent turn** back to you (this is how
  search / fetch-detail work — you do the work and render the next screen).
- A built-in **Back** button lets the user return to previous screens for free.

So: navigation between screens you've built = free; doing real work (searching,
fetching a record) = an action turn to you.

## Pattern: "a search engine for X"

1. First turn → build the **search** screen:

```xml
<view name="search" title="arXiv search">
  <form action="run_search" submit="Search">
    <input name="q" label="Query" placeholder="diffusion models" required />
  </form>
</view>
```

2. The user submits → you get `[ui-action] {"action":"run_search","values":{"q":"…"}}`.
   Do the search (your normal tools), then build the **results** screen with the
   generic `results`/`result` component (each result opens a detail screen):

```xml
<view name="results" title="Results for diffusion models">
  <results>
    <result title="Denoising Diffusion Probabilistic Models" subtitle="Ho et al., 2020"
            badge="cs.LG" action="open:2006.11239" />
    <result title="Score-Based Generative Modeling" subtitle="Song et al., 2021"
            action="open:2011.13456" />
  </results>
  <link to="search">← New search</link>
</view>
```

3. Clicking a result sends `[ui-action] {"action":"open:2006.11239"}`. Fetch the record
   and build a **detail** screen (`<view name="detail:2006.11239">`) with a
   `<link to="results">← Back to results</link>`.

The user can now move search ⇄ results ⇄ detail; only searching and opening a new
record cost a turn.

## Vocabulary (allow-listed — unknown tags/attrs are rejected)

**Layout:** `view`(name?,title?) · `stack`(gap?,align?) · `row`(gap?,align?,justify?) ·
`grid`(cols 1-6) · `card`(title?,accent?) · `divider`.
**Display:** `heading`(level 1-3) · `text`(tone?,weight?) · `badge`(tone?) ·
`image`(src,alt?) · `link`(href? OR to?) · `list`(ordered?)/`item` · `table`/`tr`/`th`/`td`.
**Inputs (in a `form`):** `form`(action,submit?) · `input`(name,type?,label?,placeholder?,value?,required?) ·
`select`(name,…)/`option`(value) · `checkbox`(name,label?) ·
`button`(label, **action** OR **to**, variant?, fields?).
**Component:** `results` → `result`(title, subtitle?, badge?, id?, action? | to?).

## Rules

- One `<view>` root per `present_view` call; give each screen a `name`.
- `to=` for navigation between your screens; `action=` only for work you must do.
- Allow-listed tags/attributes only. `href`/`src` must be `https:`/`mailto:`/relative.
- Always pass `fallbackText` (a one-line summary) and share the returned `url` with the
  user so they can open the app.
