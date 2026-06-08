---
"@moxxy/cli": minor
"@moxxy/sdk": minor
---

Slim the loop modes to three and turn plugin management into a first-class,
plug/unplug system.

Modes: the registry now ships only `default` (the Claude Code-style ReAct loop,
package renamed `@moxxy/mode-tool-use` → `@moxxy/mode-default`, export
`toolUseModePlugin` → `defaultModePlugin`), `goal` (autonomous auto-approve
loop), and `research` (mode-name renamed from `deep-research`). The `bmad`,
`developer`, and `plan-execute` modes are removed. Persisted preferences with
the old mode names (`tool-use`, `deep-research`) are migrated on read, so
existing sessions keep working.

Plugins: the standalone "marketplace" is gone — install/remove/enable/disable
and the installable-plugin catalog now live in `@moxxy/plugin-plugins-admin`.
The `moxxy plugins` CLI gains `search`, `install`, `remove`, `enable`,
`disable`, and `open` subcommands (alongside `list`/`reload`/`new`), and the TUI
gains a `/plugins` picker (tabbed by plugin kind) to plug/unplug plugins live.
The model can manage plugins on request via new `search_plugins` (npm registry +
catalog discovery), `enable_plugin`, and `disable_plugin` tools, plus the
existing `install_plugin` / `uninstall_plugin` — so "find me a plugin for X and
install it" / "disable plugin X" work in natural language. Disabling a plugin now
persists to `~/.moxxy/config.yaml` AND is honored by `pluginHost.reload()`, so a
disabled plugin is never silently resurrected.

SDK: `PluginHostHandle.list()` entries carry an optional `kinds` array; new
`PluginsAdminView` / `InstallablePluginView` / `LoadedPluginView` session
capabilities back the `/plugins` picker; `SessionOptions` gains an
`isPluginDisabled` predicate.
