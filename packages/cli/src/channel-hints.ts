import {
  INSTALLABLE_PLUGIN_CATALOG,
  type PluginCatalogEntry,
} from '@moxxy/plugin-plugins-admin';

/**
 * Channel-command → installable-package lookup for the slim kernel: when
 * `moxxy <name>` doesn't match a registered channel, this answers "is that a
 * channel whose package installs on demand?" so bin.ts / `moxxy channels
 * start` print an install hint instead of "unknown command".
 *
 * Derived from the catalog's `provides` declarations — a channel is hintable
 * exactly when its catalog entry declares `{category: 'channel', name}`. The
 * previous hand-listed command→package map here drifted one entry behind
 * every new channel; now the catalog entry (which every channel needs anyway
 * for install-on-first-use) is the single source.
 */
export function findCatalogEntryForChannel(command: string): PluginCatalogEntry | undefined {
  const name = command.toLowerCase();
  return INSTALLABLE_PLUGIN_CATALOG.find((e) =>
    e.provides?.some((p) => p.category === 'channel' && p.name === name),
  );
}
