import { loadCategoryDefault, setCategoryDefault, type UserConfigOptions } from '@moxxy/config';
import { moxxyHome } from '@moxxy/sdk/server';

import {
  createOptionalPluginInstaller,
  isOptionalPluginInstalled,
  type OptionalPlugin,
  type OptionalPluginInstallerOptions,
} from './optional-plugin';

export const LOCAL_PIPER_PACKAGE = '@moxxy/plugin-tts-local';
export const LOCAL_PIPER_SYNTHESIZER = 'local-piper';

const LOCAL_PIPER: OptionalPlugin = {
  packageName: LOCAL_PIPER_PACKAGE,
  category: 'synthesizer',
  contribution: LOCAL_PIPER_SYNTHESIZER,
  label: 'offline voice',
};

export type LocalPiperInstallerOptions = OptionalPluginInstallerOptions;

/** Whether the on-device Piper package is complete on disk. */
export async function isLocalPiperInstalled(home = moxxyHome()): Promise<boolean> {
  return isOptionalPluginInstalled(LOCAL_PIPER, home);
}

/** Install (when missing), enable and select Piper as the voice; single-flight. */
export function createLocalPiperInstaller(
  options: LocalPiperInstallerOptions = {},
): () => Promise<void> {
  return createOptionalPluginInstaller(LOCAL_PIPER, options);
}

/**
 * Make the Piper the installer just copied the voice, unless the user already
 * chose one. `copied` is what this launch seeded, so a later launch — or a
 * user who switched to another voice — is never overridden.
 */
export async function adoptSeededLocalPiper(
  copied: ReadonlyArray<string>,
  opts: UserConfigOptions = {},
): Promise<boolean> {
  if (!copied.includes(LOCAL_PIPER_PACKAGE)) return false;
  if ((await loadCategoryDefault('synthesizer', opts)) !== null) return false;
  await setCategoryDefault('synthesizer', LOCAL_PIPER_SYNTHESIZER, opts);
  return true;
}
