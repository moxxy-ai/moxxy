import { definePlugin, type Plugin } from '@moxxy/sdk';
import {
  buildInstallPluginTool,
  buildUninstallPluginTool,
  type InstallPluginDeps,
  type PluginSnapshot,
} from './install.js';
import {
  buildDisablePluginTool,
  buildEnablePluginTool,
  type PluginToggleDeps,
} from './toggle.js';
import {
  buildListDefaultsTool,
  buildSetDefaultTool,
  type CategoryDefaultsDeps,
} from './defaults.js';
import { buildSearchPluginsTool } from './search.js';

export {
  buildInstallPluginTool,
  buildUninstallPluginTool,
  installPluginPackage,
  removePluginPackage,
  userPluginsDir,
  type InstallPluginDeps,
  type InstallPluginPackageOptions,
  type InstallPluginPackageResult,
  type PluginSnapshot,
  type RemovePluginPackageOptions,
  type RemovePluginPackageResult,
} from './install.js';

export {
  buildDisablePluginTool,
  buildEnablePluginTool,
  type PluginToggleDeps,
} from './toggle.js';

export {
  buildListDefaultsTool,
  buildSetDefaultTool,
  type CategoryDefaultsDeps,
} from './defaults.js';

export {
  buildSearchPluginsTool,
  searchInstallablePlugins,
  type PluginSearchResult,
  type FetchLike,
} from './search.js';

// Enable/disable + category-default persistence (formerly
// @moxxy/plugin-marketplace/config-state).
export {
  clearPluginState,
  defaultUserConfigPath,
  isPluginDisabled,
  loadDisabledPackageNames,
  setCategoryDefault,
  setPluginEnabled,
  type PluginConfigOptions,
} from './config.js';

// Curated installable-plugin catalog + the pure status/option helpers the
// `moxxy plugins` CLI and the TUI `/plugins` picker share (formerly
// @moxxy/plugin-marketplace/catalog).
export {
  applyGitRef,
  buildInstallSpec,
  buildPluginActionOptions,
  buildPluginCatalogOptions,
  formatPluginCatalogStatus,
  INSTALLABLE_PLUGIN_CATALOG,
  resolveCatalogEntry,
  resolveCatalogPackageName,
  type PluginAction,
  type PluginActionOption,
  type PluginCatalogEntry,
  type PluginCatalogStatus,
  type PluginPickerOption,
} from './catalog.js';

export interface BuildPluginsAdminOpts {
  /**
   * How the install tool hot-reloads after a successful install.
   * Closure-bound so this package doesn't import core.
   */
  readonly reload: () => Promise<void>;
  /**
   * Returns a snapshot of currently-registered contributions so the
   * tool can report what the new install brought in. Typically reads
   * `session.tools.list()`, `session.agents.list()`, etc.
   */
  readonly snapshot: () => PluginSnapshot;
  /**
   * Persist + apply a plugin enable/disable toggle (see {@link PluginToggleDeps}).
   * Bound by the host so the `enable_plugin` / `disable_plugin` tools can plug /
   * unplug a plugin from the live session and across restarts.
   */
  readonly setEnabled: PluginToggleDeps['setEnabled'];
  /** Per-category active default + swappable items (the `list_defaults` tool). */
  readonly categories: CategoryDefaultsDeps['categories'];
  /** Persist + apply a category default swap (the `set_default` tool). */
  readonly setCategoryDefault: CategoryDefaultsDeps['setCategoryDefault'];
}

/**
 * `@moxxy/plugin-plugins-admin` — model-callable plugin management: the
 * `install_plugin` / `uninstall_plugin` tools (npm into ~/.moxxy/plugins +
 * hot-reload) and the `enable_plugin` / `disable_plugin` tools (config-backed
 * plug/unplug of any registered plugin). Disable this plugin to lock the
 * plugin set.
 */
export function buildPluginsAdminPlugin(opts: BuildPluginsAdminOpts): Plugin {
  const installDeps: InstallPluginDeps = { reload: opts.reload, snapshot: opts.snapshot };
  const toggleDeps: PluginToggleDeps = { setEnabled: opts.setEnabled, snapshot: opts.snapshot };
  const defaultsDeps: CategoryDefaultsDeps = {
    categories: opts.categories,
    setCategoryDefault: opts.setCategoryDefault,
  };
  return definePlugin({
    name: '@moxxy/plugin-plugins-admin',
    version: '0.0.0',
    tools: [
      buildSearchPluginsTool(),
      buildInstallPluginTool(installDeps),
      buildUninstallPluginTool(installDeps),
      buildEnablePluginTool(toggleDeps),
      buildDisablePluginTool(toggleDeps),
      buildListDefaultsTool(defaultsDeps),
      buildSetDefaultTool(defaultsDeps),
    ],
  });
}
