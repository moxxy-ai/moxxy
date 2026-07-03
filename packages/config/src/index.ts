export { defineConfig } from './define.js';
export { loadConfig, type LoadConfigOptions, type LoadedConfig } from './loader.js';
export { mergeConfigs } from './merge.js';
export {
  buildConfigPlugin,
  type ConfigApplier,
  type ConfigApplyResult,
} from './plugin.js';
export {
  moxxyConfigSchema,
  pluginSettingsSchema,
  permissionsConfigSchema,
  embeddingsConfigSchema,
  securityConfigSchema,
  watcherModeSchema,
  type MoxxyConfig,
  type PluginSettings,
  type PermissionsConfig,
  type EmbeddingsConfig,
  type SecurityConfig,
  type WatcherMode,
} from './schema.js';
export {
  pluginsTreeSchema,
  providerSlotSchema,
  providerItemSchema,
  categorySlotSchema,
  PLUGIN_CATEGORY_KEYS,
  type PluginsTree,
  type ProviderSlot,
  type ProviderItem,
  type CategorySlot,
  type PluginCategoryKey,
} from './plugins-tree-schema.js';
// Comment-preserving writers for ~/.moxxy/config.yaml — the single store that
// replaced ~/.moxxy/preferences.json (runtime provider/mode/model/disabled).
export {
  applyInitConfig,
  clearPluginState,
  defaultUserConfigPath,
  isPluginDisabled,
  loadActiveModel,
  loadActiveProvider,
  loadDisabledPackageNames,
  loadDisabledProviders,
  loadProviderItems,
  removeProviderItem,
  setCategoryDefault,
  setPluginEnabled,
  setProviderEnabled,
  setProviderItemConfig,
  setProviderModel,
  type ProviderItemState,
  type InitConfigSelections,
  type UserConfigOptions,
} from './user-config.js';

export {
  configWriteMutex,
  setConfigValue,
  type ConfigScope,
  type SetConfigValueOptions,
  type SetConfigValueResult,
} from './config-writer.js';
