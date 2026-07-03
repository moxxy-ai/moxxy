import {
  INSTALLABLE_PLUGIN_CATALOG,
  type PluginCatalogEntry,
} from '@moxxy/plugin-plugins-admin';

/**
 * Channel-command → installable-package mapping for the slim kernel: when
 * `moxxy <name>` doesn't match a registered channel, this answers "is that a
 * channel whose package installs on demand?" so bin.ts / `moxxy channels
 * start` print an install hint instead of "unknown command".
 */
const CHANNEL_COMMANDS: Readonly<Record<string, string>> = {
  telegram: '@moxxy/plugin-telegram',
  slack: '@moxxy/plugin-channel-slack',
  web: '@moxxy/plugin-channel-web',
  http: '@moxxy/plugin-channel-http',
};

export function findCatalogEntryForChannel(command: string): PluginCatalogEntry | undefined {
  const pkg = CHANNEL_COMMANDS[command.toLowerCase()];
  if (!pkg) return undefined;
  return INSTALLABLE_PLUGIN_CATALOG.find((e) => e.packageName === pkg);
}
