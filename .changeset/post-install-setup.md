---
'@moxxy/sdk': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/cli': minor
'@moxxy/plugin-cli': minor
---

Post-install setup resolves IN the TUI: installing a plugin that declares a
`moxxy.setup` step now opens a configuration dialog on the spot (masked
secrets, y/n booleans, select lists) instead of pointing at `moxxy init` —
values persist through the same shared writer (secrets → vault +
`${vault:NAME}` option refs). New `/setup [package]` command (re)configures
any installed plugin and re-enables one left disabled by a skipped required
setup. New `PluginsAdminView.setupSpec`/`applySetup` seams; the init wizard
now shares the exact same `applySetupValues` write path.
