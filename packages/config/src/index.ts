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
  providerSettingsSchema,
  permissionsConfigSchema,
  embeddingsConfigSchema,
  securityConfigSchema,
  watcherModeSchema,
  type MoxxyConfig,
  type PluginSettings,
  type ProviderSettings,
  type PermissionsConfig,
  type EmbeddingsConfig,
  type SecurityConfig,
  type WatcherMode,
} from './schema.js';
