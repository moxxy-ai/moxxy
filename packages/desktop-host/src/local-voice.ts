import { loadCategoryDefault, setCategoryDefault, type UserConfigOptions } from '@moxxy/config';
import { moxxyHome } from '@moxxy/sdk/server';

import {
  createOptionalPluginInstaller,
  isOptionalPluginInstalled,
  type OptionalPlugin,
  type OptionalPluginInstallerOptions,
} from './optional-plugin';

export const LOCAL_VOICE_PACKAGE = '@moxxy/plugin-tts-local';
export const LOCAL_VOICE_SYNTHESIZER = 'local-supertonic';
/** What the local voice was called before Supertonic: old settings still say it. */
const LEGACY_LOCAL_VOICE_SYNTHESIZER = 'local-piper';

const LOCAL_VOICE: OptionalPlugin = {
  packageName: LOCAL_VOICE_PACKAGE,
  category: 'synthesizer',
  contribution: LOCAL_VOICE_SYNTHESIZER,
  label: 'offline voice',
};

export type LocalVoiceInstallerOptions = OptionalPluginInstallerOptions;

/** Whether the on-device voice package is complete on disk. */
export async function isLocalVoiceInstalled(home = moxxyHome()): Promise<boolean> {
  return isOptionalPluginInstalled(LOCAL_VOICE, home);
}

/** Install (when missing), enable and select the on-device voice; single-flight. */
export function createLocalVoiceInstaller(
  options: LocalVoiceInstallerOptions = {},
): () => Promise<void> {
  return createOptionalPluginInstaller(LOCAL_VOICE, options);
}

/** Whoever used the old local voice now uses Supertonic, with nothing to do. */
export async function migrateLocalVoiceChoice(opts: UserConfigOptions = {}): Promise<boolean> {
  if ((await loadCategoryDefault('synthesizer', opts)) !== LEGACY_LOCAL_VOICE_SYNTHESIZER) return false;
  await setCategoryDefault('synthesizer', LOCAL_VOICE_SYNTHESIZER, opts);
  return true;
}

/**
 * Make the voice the installer just copied the active one, unless the user already
 * chose one. `copied` is what this launch seeded, so a later launch — or a
 * user who switched to another voice — is never overridden.
 */
export async function adoptSeededLocalVoice(
  copied: ReadonlyArray<string>,
  opts: UserConfigOptions = {},
): Promise<boolean> {
  if (!copied.includes(LOCAL_VOICE_PACKAGE)) return false;
  if ((await loadCategoryDefault('synthesizer', opts)) !== null) return false;
  await setCategoryDefault('synthesizer', LOCAL_VOICE_SYNTHESIZER, opts);
  return true;
}
