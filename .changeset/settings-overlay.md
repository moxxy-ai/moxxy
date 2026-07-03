---
'@moxxy/config': minor
'@moxxy/sdk': minor
'@moxxy/core': patch
'@moxxy/cli': minor
'@moxxy/plugin-cli': minor
---

`/settings` (alias `/config`): a curated in-TUI config panel — reasoning,
prompt caching, elision, lazy tools, loop guard, plugin security, TUI theme
and footer hints toggle/cycle in place, persist to the user config through
the ONE schema-validated comment-preserving writer (new `setConfigValue`,
which the `config_set` tool now also delegates to), and live-apply via the
new optional `SessionLike.configAdmin` seam (RemoteSession degrades to
"applies on restart"). New `tui:` config section (`theme: default|mono`,
`hints`, `keys` Ctrl-letter overrides for force-send/drop-queued/
expand-tools) projected onto the TUI's env conventions at launch.
