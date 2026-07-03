---
'@moxxy/cli': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/mode-goal': minor
'@moxxy/mode-deep-research': minor
'@moxxy/plugin-subagents': minor
'@moxxy/plugin-oauth': minor
'@moxxy/plugin-computer-control': minor
'@moxxy/plugin-channel-http': minor
'@moxxy/plugin-usage-stats': minor
---

Slim wave, batch 1: seven plugins move out of the CLI binary and install on
demand from npm — `@moxxy/mode-goal`, `@moxxy/mode-deep-research` (now
npm-depends on `@moxxy/plugin-subagents` so one install brings both),
`@moxxy/plugin-subagents`, `@moxxy/plugin-oauth`,
`@moxxy/plugin-computer-control`, `@moxxy/plugin-channel-http`,
`@moxxy/plugin-usage-stats`. All are in the installable catalog (the
`/plugins` picker installs them one-keystroke; `/goal`, `/collab` and `/mode`
offer the install at point of use), and `moxxy init` installs a picked
non-bundled default mode during setup so the written config never floors
back on first boot. New `scripts/e2e-slim-install.mjs` fresh-install smoke.
