---
title: '@moxxy/plugin-plugins-admin'
description: Model-callable plugin management — install / uninstall / enable / disable.
---

`@moxxy/plugin-plugins-admin` lets the agent manage its own plugin set.
`install_plugin` shells out to npm into `~/.moxxy/plugins` and
hot-reloads; `enable_plugin` / `disable_plugin` plug or unplug any
registered plugin (persisted across restarts). It also ships the
curated installable-plugin catalog and the status/option helpers the
`moxxy plugins` CLI command and the TUI `/plugins` picker share.

Disable this plugin to lock the plugin set.

## Install

```sh
pnpm add @moxxy/plugin-plugins-admin
```

## Build

```ts
import { buildPluginsAdminPlugin } from '@moxxy/plugin-plugins-admin';

const plugin = buildPluginsAdminPlugin({
  reload: () => session.pluginHost.reload(),
  snapshot: () => ({ tools: session.tools.list().map((t) => t.name) /* … */ }),
  setEnabled: /* host-bound enable/disable persistence */,
});
session.pluginHost.registerStatic(plugin);
```

## Tools

| Tool | Effect |
|---|---|
| `install_plugin` | npm-install a plugin into `~/.moxxy/plugins` and hot-reload. |
| `uninstall_plugin` | Remove an installed plugin package. |
| `enable_plugin` | Plug a registered plugin into the live session (persisted). |
| `disable_plugin` | Unplug a registered plugin (persisted). |

## CLI + TUI

The same machinery backs the `moxxy plugins` command
(`list` / `install <spec>` / `remove <pkg>` / `enable <pkg>` /
`disable <pkg>` / `open <id>` / `reload` / `new <name>`) and the TUI
`/plugins` picker.

## Exports

- `buildPluginsAdminPlugin` — the plugin factory.
- `buildInstallPluginTool`, `buildUninstallPluginTool`,
  `buildEnablePluginTool`, `buildDisablePluginTool` — individual tools.
- `installPluginPackage`, `removePluginPackage`, `userPluginsDir` —
  install primitives.
- `INSTALLABLE_PLUGIN_CATALOG`, `resolveCatalogEntry`,
  `buildPluginCatalogOptions`, `formatPluginCatalogStatus` — catalog +
  picker helpers shared by the CLI and TUI.
- `loadDisabledPackageNames`, `setPluginEnabled`, `isPluginDisabled`,
  `clearPluginState` — enable/disable persistence.

## See also

- [CLI](./cli.md) — `moxxy plugins` subcommands.
- [Authoring a plugin](../guides/authoring-a-plugin.md).
