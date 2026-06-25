/**
 * The kernel packages that must always be present for the app to function — the
 * "you can swap, but you can't break" floor at the package level. These can have
 * their *default* swapped (e.g. point `plugins.mode.default` at another mode) but
 * the package itself can never be disabled or uninstalled, because without it
 * there is no interaction surface, no agent loop, no way to act, or no way to
 * install anything else.
 *
 * This is also the slim-core bundle set (Pillar 3): everything else is
 * on-demand. Keep the two in lockstep.
 */
export const CRITICAL_PACKAGES: ReadonlySet<string> = new Set([
  '@moxxy/plugin-cli', // the only interaction surface (the TUI)
  '@moxxy/tools-builtin', // the agent's hands (read/write/edit/bash)
  '@moxxy/mode-default', // the loop
  '@moxxy/plugin-plugins-admin', // the bootstrap that installs everything else
  '@moxxy/plugin-config', // config_set/get/reload — needed to manage the manifest
  '@moxxy/plugin-vault', // secret store for the provider key
  '@moxxy/compactor-summarize', // context-lifecycle floor
  '@moxxy/cache-strategy-stable-prefix', // context-lifecycle floor
]);

/** Whether a package is a non-disableable kernel module. */
export function isCriticalPackage(packageName: string): boolean {
  return CRITICAL_PACKAGES.has(packageName);
}
