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
  buildCapabilityReport,
  buildInstallPluginTool,
  buildUninstallPluginTool,
  installPluginPackage,
  installPluginPackagePinned,
  removePluginPackage,
  userPluginsDir,
  type InstallCapabilityReport,
  type InstallPluginDeps,
  type InstallPluginPackageOptions,
  type InstallPluginPackageResult,
  type PinnedInstallOptions,
  type PluginSnapshot,
  type RemovePluginPackageOptions,
  type RemovePluginPackageResult,
} from './install.js';

export {
  describeCapabilitySurface,
  summarizeCapabilitySurface,
  undeclaredToolsWarning,
  type CapabilitySurfaceRow,
} from './capability-copy.js';

export { pinFirstPartySpec } from './pin.js';

export {
  applySetupValues,
  listPluginSetups,
  readPluginSetup,
  setupFieldVaultKey,
  type ApplySetupOptions,
  type ApplySetupResult,
  type SetupFieldValue,
  type SetupSpecVault,
} from './setup-spec.js';
export type { PluginSetupField, PluginSetupSpec } from '@moxxy/sdk';

export { diffSnapshot, packageNameFromSpec, SNAPSHOT_KINDS } from './shared.js';

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

// Signed plugin-registry v1 client: Ed25519-verified index fetch + cache +
// fallback, install-source resolution with signed version pins, and the
// capability-manifest comparison (see registry.ts for the format spec).
export {
  checkCapabilityManifest,
  DEFAULT_REGISTRY_URL,
  fetchSignedRegistry,
  parseRegistryIndex,
  REGISTRY_CACHE_TTL_MS,
  REGISTRY_INDEX_VERSION,
  resolveInstallSource,
  verifyRegistryIndex,
  type CapabilityManifestCheck,
  type FetchSignedRegistryOptions,
  type PluginRegistryEntry,
  type PluginRegistryIndex,
  type RegistryFallbackReason,
  type RegistryFetchLike,
  type RegistryResultEntry,
  type ResolvedInstallSource,
  type SignedRegistryResult,
} from './registry.js';
export { REGISTRY_PUBLIC_KEY } from './registry-key.js';

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
  findCatalogEntryForContribution,
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
  /** Host CLI version — pins bare `@moxxy/*` installs (see {@link InstallPluginDeps}). */
  readonly cliVersion?: string;
  /** Live tool isolation lookup for the install capability report (see {@link InstallPluginDeps}). */
  readonly toolIsolation?: InstallPluginDeps['toolIsolation'];
}

/**
 * `@moxxy/plugin-plugins-admin` — model-callable plugin management: the
 * `install_plugin` / `uninstall_plugin` tools (npm into ~/.moxxy/plugins +
 * hot-reload) and the `enable_plugin` / `disable_plugin` tools (config-backed
 * plug/unplug of any registered plugin). Disable this plugin to lock the
 * plugin set.
 */
export function buildPluginsAdminPlugin(opts: BuildPluginsAdminOpts): Plugin {
  const installDeps: InstallPluginDeps = {
    reload: opts.reload,
    snapshot: opts.snapshot,
    ...(opts.cliVersion ? { cliVersion: opts.cliVersion } : {}),
    ...(opts.toolIsolation ? { toolIsolation: opts.toolIsolation } : {}),
  };
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
