---
'@moxxy/sdk': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/cli': minor
'@moxxy/plugin-cli': patch
---

The `/plugins` Installable tab now actually installs: selecting a catalog
plugin npm-installs it into `~/.moxxy/plugins`, persists the enable,
hot-reloads the plugin host, and reports which contributions registered —
instead of printing a CLI command to run elsewhere. New optional
`PluginsAdminView.install` seam (RemoteSession degrades to the printed
command).

On-demand installs are now version-pinned: bare `@moxxy/*` specs resolve at
the CLI's own version across every install path (`install_plugin` tool,
`moxxy plugins install`, init's provider/extras steps, the TUI picker), with
a 404→latest retry for pins an older CLI can't satisfy. The changeset fixed
group widens to all `@moxxy/plugin-*` + `@moxxy/mode-*` so future releases
co-version. New `installPluginPackagePinned` / `pinFirstPartySpec` exports.
