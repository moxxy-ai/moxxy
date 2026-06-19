---
name: generative-ui
description: Generate an interactive, navigable UI (generative/dynamic/agentic UI) in the user's browser, backed by real data from your tools. Only when the user explicitly asks for one.
triggers: ["generative ui", "dynamic ui", "agentic ui", "generative interface", "dynamic interface", "agentic interface", "interactive ui for", "generative app", "agentic app"]
allowed-tools: [present_view, web_fetch, browser_session]
---

# Generative UI

Generate an interactive, navigable UI — a "generative / dynamic / agentic UI" — for
the user, backed by **real data**, and hand them a link.

## When to use this — and when NOT to

**Use `present_view` ONLY when the user explicitly asks for a generative / dynamic /
agentic UI (or interface).**

- ✅ "present me a generative ui for arXiv papers"
- ✅ "show me a dynamic ui for flight search WAW→KRK"
- ✅ "make me an agentic ui for my GitHub repos", "interactive ui for X"
- ❌ "search flights SFO→JFK", "find me papers on transformers", "what's the weather"
  → **answer in plain text. Do NOT generate a UI.** Ordinary searches/questions are
  handled the way you always have.

If you're unsure, default to a normal text answer. A generative UI is for when the
user wants a *thing they can use*, not a one-off answer.

## Use REAL data — never demo data

The UI must show **real results fetched from real sources**, not placeholders you made
up. Get data with your tools — `web_fetch` (JSON APIs, public endpoints, HTML pages),
`browser_session` (JS-heavy sites), or any MCP/provider tool available. **Never
fabricate results, prices, IDs, or links.** If you can't find a usable data source,
render a clear message saying so (a `card` with `text tone="warn"`) instead of
inventing data.

## Render upfront — don't make the user re-ask

If the user already gave you the parameters (e.g. "WAW → KRK"), **go straight to
results in the same turn** — don't show an empty form and wait for them to submit
what they already told you. Generate the populated UI now.

## The loader-first flow (every fetch)

A `present_view` call flushes to the browser immediately, so within ONE turn:

1. `present_view` a **loading** screen (skeleton / spinner) under a screen `name`.
2. Fetch the **real** data with your tools.
3. `present_view` the **results** under the **same `name`** — it replaces the
   skeleton in place.

Use the same `name` for the loading and loaded states so the result swaps the
skeleton in place (don't leave a dangling "loading" screen).

### Example: "present me a dynamic ui for flight search WAW → KRK"

Turn 1, call 1 — show the loading state instantly:

```xml
<view name="results" title="WAW → KRK">
  <text tone="muted">Searching live flights…</text>
  <skeleton rows="5" />
</view>
```

Then fetch real data (`web_fetch` a flights API / source). Turn 1, call 2 — replace
with real results under the same name:

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

## The UI model

Multiple named screens the user navigates between (one `present_view` per screen):

- **`to="<screenName>"`** on a `link`/`button` → jumps to that screen
  **instantly, client-side, with no new turn** (if you've already built it).
- **`action="…"`** on a form/button → sends an **agent turn** back to you (this is
  how search / fetch-detail work — fetch real data, then render the next screen).
- A built-in **Back** button returns to previous screens for free.
- A floating chat button on the surface lets the user ask for refinements; treat
  those as normal prompts — re-render the affected screen with `present_view` (same
  `name`) to update it live.

Clicking a result sends `[ui-action] {"action":"open:LO3923"}` → fetch that record's
real details → build a `detail:LO3923` screen with `<link to="results">← Back</link>`.

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
