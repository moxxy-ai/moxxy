---
"@moxxy/cli": patch
---

Polish the TUI: simplify the `/plugins` picker and make slash autocomplete
scrollable.

- `/plugins` now uses a few basic tabs — **Providers, Modes, Channels, Tools,
  Others, Installable** — instead of one tab per contribution kind. Disabled
  plugins live under "Others" with an `[off]` badge. Heading is just "Plugins".
- Modal headers no longer paint a filled background band (it rendered as dark
  "bars" on many terminals) — the title + tabs sit as clean text, with the
  active tab marked by an inverse pill.
- The `/` slash-command dropdown is no longer capped at 8 entries: it shows a
  scrolling window over the full command set (with `↑ N more` / `↓ N more`),
  so every command is reachable with ↑↓.
