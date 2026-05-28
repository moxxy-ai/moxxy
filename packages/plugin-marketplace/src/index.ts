import { definePlugin, type Plugin } from '@moxxy/sdk';

export {
  applyGitRef,
  buildInstallSpec,
  buildMarketplaceActionOptions,
  buildMarketplaceOptions,
  DEFAULT_MARKETPLACE_CATALOG,
  formatMarketplaceStatus,
  resolveMarketplaceEntry,
  resolveMarketplacePackageName,
  type MarketplaceAction,
  type MarketplaceActionOption,
  type MarketplaceCatalogEntry,
  type MarketplaceOption,
  type MarketplacePluginStatus,
} from './catalog.js';
export {
  clearPluginState,
  defaultUserConfigPath,
  isPluginDisabled,
  loadDisabledPackageNames,
  setPluginEnabled,
  type MarketplaceConfigOptions,
} from './config-state.js';
export {
  buildMarketplaceOpenArgv,
  loadInstalledPackageNames,
  renderMarketplaceHelp,
  runMarketplaceCommand,
  type MarketplaceArgv,
  type RunMarketplaceCommandDeps,
} from './marketplace.js';

export const marketplacePlugin: Plugin = definePlugin({
  name: '@moxxy/plugin-marketplace',
  version: '0.0.0',
});
