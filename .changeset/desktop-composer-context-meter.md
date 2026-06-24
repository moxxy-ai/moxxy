---
"@moxxy/desktop": patch
---

Desktop: show context usage at a glance on the composer's model control.

- The borderless **model label** (e.g. `gpt-5.5 ▾`) now carries a hair-thin context-window meter directly beneath it — a tiny fill bar plus a tabular percentage that color-ramps to amber (≥60%) and red (≥85%) as the window fills, so current context usage is visible without opening the panel. It appears as soon as the active model's context window is known and stays in sync with the full meter inside **Model & context**.
- In the **Model & context** panel, **Prompt composition** is now a collapsible section, collapsed by default. The header keeps its `N calls · … prompt` teaser and gains a disclosure caret; expanding it reveals the cache-read / fresh-input / cache-write breakdown, cache-hit/savings line, and the per-call sparkline.
