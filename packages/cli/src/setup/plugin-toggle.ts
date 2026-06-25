import { MoxxyError } from '@moxxy/sdk';
import { type Session } from '@moxxy/core';
import { setPluginEnabled } from '@moxxy/plugin-plugins-admin';
import { isCriticalPackage } from './critical-packages.js';
import type { BuiltinEntry } from './builtin-entries.js';

export interface PluginToggleArgs {
  readonly session: Session;
  /**
   * Live disabled-package set shared with the PluginHost predicate and the
   * config applier; toggling mutates it so a runtime change survives the
   * subsequent hot-reload.
   */
  readonly disabledPackages: Set<string>;
  /** Lazily resolve the builtin entries (defined after the closure is built). */
  readonly getEntries: () => ReadonlyArray<BuiltinEntry>;
}

/**
 * Build the plug/unplug closure that mutates the live session AND persists the
 * change. Backs both the enable_plugin / disable_plugin model tools and the TUI
 * `/plugins` picker. Disable → record + unload (a builtin or a discovered
 * plugin). Enable → record + re-register a builtin or reload to re-discover an
 * installed plugin. `disabledPackages` is the same set the PluginHost reload
 * predicate reads, so a disable is never resurrected by a later reload.
 */
export function buildSetPluginEnabledLive(
  args: PluginToggleArgs,
): (packageName: string, enabled: boolean) => Promise<void> {
  const { session, disabledPackages, getEntries } = args;
  return async (packageName: string, enabled: boolean): Promise<void> => {
    // The kernel floor: a critical package can be swapped (point a category at a
    // different default) but never disabled — refuse rather than brick the app.
    if (!enabled && isCriticalPackage(packageName)) {
      throw new MoxxyError({
        code: 'PLUGIN_PROTECTED',
        message: `${packageName} is a core module and cannot be disabled.`,
        hint: 'Swap the relevant category default instead (e.g. `set_default mode <other>`), or install an alternative and point the default at it.',
        context: { package: packageName },
      });
    }
    await setPluginEnabled(packageName, enabled);
    if (!enabled) {
      disabledPackages.add(packageName);
      await session.pluginHost.unload(packageName);
      return;
    }
    disabledPackages.delete(packageName);
    if (session.pluginHost.list().some((p) => p.name === packageName)) return;
    const builtin = getEntries().find((e) => e.name === packageName);
    if (builtin) session.pluginHost.registerStatic(builtin.plugin);
    else await session.pluginHost.reload();
  };
}
