/**
 * Which runner the installed app ("shell") carries, and whether a bundle needs
 * a newer one. A bundle that does cannot run its agent on that shell: the app
 * takes the full installer for it — before staging when it can tell from the
 * manifest, or from inside the bundle itself once an older app has loaded it.
 *
 * Dependency-free, like the rest of this folder: the bootstrap bakes it in.
 */

import type { AppManifest } from './manifest.js';

/** Apps that carried a runner before they said which (`MOXXY_SHELL_RUNNER_PROTOCOL`).
 *  Any other app that says nothing is older than every runner still served. */
const BEFORE_APPS_SAID: Readonly<Record<string, number>> = { '0.42.0': 24 };

/** The environment variable a bootstrap sets to its runner protocol. */
export const SHELL_RUNNER_PROTOCOL_ENV = 'MOXXY_SHELL_RUNNER_PROTOCOL';

export function shellRunnerProtocol(shell: { declared: string | undefined; shellVersion: string }): number {
  if (shell.declared && /^\d+$/.test(shell.declared)) return Number(shell.declared);
  return BEFORE_APPS_SAID[shell.shellVersion] ?? 0;
}

/** True when a bundle that needs runner protocol `needed` was loaded by an
 *  installed app carrying an older one. Never for the installed app's own bundle. */
export function shellIsBehind(o: {
  bundleVersion: string | undefined;
  declared: string | undefined;
  shellVersion: string;
  needed: number;
}): boolean {
  if (!o.bundleVersion) return false;
  return shellRunnerProtocol(o) < o.needed;
}

/** True when the bundle needs a newer runner than `cliRunnerProtocol` — by the
 *  signed stamp of older releases or the unsigned word of current ones. Unknown
 *  on either side is no constraint. */
export function needsNewerRunner(
  m: Pick<AppManifest, 'runnerProtocol' | 'needsRunnerProtocol'>,
  cliRunnerProtocol?: number,
): boolean {
  if (typeof cliRunnerProtocol !== 'number') return false;
  return Math.max(m.runnerProtocol ?? -1, m.needsRunnerProtocol ?? -1) > cliRunnerProtocol;
}
