/**
 * How a launch tells whether there is anything to set up, without hashing the
 * installed extensions every time: the installer that was last set up, and the
 * runner version last brought in, are written down once they are done.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import type { AppSetupState, AppSetupStepId } from '@moxxy/desktop-ipc-contract';

const stampSchema = z.object({
  installer: z.string().min(1).max(200).nullable(),
  components: z.string().min(1).max(100).nullable(),
});
export type SetupStamp = z.infer<typeof stampSchema>;

const NO_STAMP: SetupStamp = { installer: null, components: null };
const stampPath = (moxxyHome: string): string => path.join(moxxyHome, 'desktop', 'setup-stamp.json');

/** Names the installer by what it carries: its version and its extensions.
 *  Null for a build that carries none (a development run). */
export async function installerIdentity(resourcesPath: string, shellVersion: string): Promise<string | null> {
  try {
    const fingerprints = await fs.readFile(path.join(resourcesPath, 'plugins-seed', 'seed-fingerprints.json'));
    return createHash('sha256').update(shellVersion).update('\0').update(fingerprints).digest('hex');
  } catch {
    return null;
  }
}

export async function readSetupStamp(moxxyHome: string): Promise<SetupStamp> {
  try {
    const parsed = stampSchema.safeParse(JSON.parse(await fs.readFile(stampPath(moxxyHome), 'utf8')));
    return parsed.success ? parsed.data : NO_STAMP;
  } catch {
    return NO_STAMP;
  }
}

export async function writeSetupStamp(moxxyHome: string, stamp: SetupStamp): Promise<void> {
  const file = stampPath(moxxyHome);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(stamp, null, 2)}\n`);
}

export interface SetupNeedsInput {
  readonly identity: string | null;
  readonly stamp: SetupStamp;
  /** The runner version the running app was built with. */
  readonly componentsVersion: string;
  /** The runner or an extension is older than that version. */
  readonly componentsBehind: boolean;
  /** Extensions were installed here before this launch. */
  readonly hasProfile: boolean;
}

export interface SetupNeeds {
  readonly reason: AppSetupState['reason'];
  readonly steps: ReadonlyArray<AppSetupStepId>;
}

export function setupNeeds(input: SetupNeedsInput): SetupNeeds {
  if (input.identity === null) return { reason: null, steps: [] };
  const newInstaller = input.identity !== input.stamp.installer;
  // One attempt per version: what could not be brought in stays as it is
  // until the next update, rather than holding every launch.
  const components = input.componentsBehind && input.stamp.components !== input.componentsVersion;
  // The installer's own first: what it carries is then no longer behind, and
  // npm is asked only for what it did not carry.
  const steps: AppSetupStepId[] = [
    ...(newInstaller ? (['extensions', 'connections'] as const) : []),
    ...(components ? (['components'] as const) : []),
  ];
  if (steps.length === 0) return { reason: null, steps };
  return { reason: newInstaller && !input.hasProfile ? 'install' : 'update', steps };
}
