/**
 * Plugin enable/disable + category-default persistence. The implementation now
 * lives in `@moxxy/config` (`user-config.ts`) so the lean runner and channel
 * plugins can persist runtime quick-switches without depending on this admin
 * package. Re-exported here unchanged for the existing plugins-admin API + the
 * `moxxy plugins` CLI; `PluginConfigOptions` is the old alias for
 * `UserConfigOptions`.
 */
export {
  clearPluginState,
  defaultUserConfigPath,
  isPluginDisabled,
  loadDisabledPackageNames,
  setCategoryDefault,
  setPluginEnabled,
  type UserConfigOptions as PluginConfigOptions,
} from '@moxxy/config';
