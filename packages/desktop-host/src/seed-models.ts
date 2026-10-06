import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * First-launch model seeding: copy the models the installer ships
 * (`models-seed/<kind>/<id>`, assembled by
 * apps/desktop/scripts/bundle-models-seed.mjs) into `<moxxyHome>/models`, so
 * offline voice works without a download. The `.model.ok` marker is the one
 * `@moxxy/model-fetch` writes after a verified extraction; a target carrying
 * the same marker is the same model and is left alone.
 */
export interface SeedModelsOptions {
  /** `process.resourcesPath` of the packaged app (contains `models-seed`). */
  readonly resourcesPath: string;
  /** The moxxy home dir (usually `~/.moxxy`). */
  readonly moxxyHome: string;
  readonly log?: (msg: string) => void;
}

export interface SeedModelsResult {
  /** `<kind>/<id>` of every model copied from the installer. */
  readonly copied: ReadonlyArray<string>;
  /** `<kind>/<id>` of every model the user already had. */
  readonly skipped: ReadonlyArray<string>;
}

const MODEL_MARKER = '.model.ok';

export async function seedModelsFromResources(
  opts: SeedModelsOptions,
): Promise<SeedModelsResult> {
  const seedRoot = path.join(opts.resourcesPath, 'models-seed');
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const kind of await listDirectories(seedRoot)) {
    for (const id of await listDirectories(path.join(seedRoot, kind))) {
      const source = path.join(seedRoot, kind, id);
      const marker = await readMarker(source);
      if (marker === null) continue; // not a finished model: nothing to trust
      const target = path.join(opts.moxxyHome, 'models', kind, id);
      if ((await readMarker(target)) === marker) {
        skipped.push(`${kind}/${id}`);
        continue;
      }
      await replaceDirectory(source, target);
      copied.push(`${kind}/${id}`);
    }
  }
  if (copied.length > 0 || skipped.length > 0) {
    opts.log?.(
      `models-seed: copied ${copied.length} model(s)` +
        (skipped.length > 0 ? ` (${skipped.length} already present)` : ''),
    );
  }
  return { copied, skipped };
}

/** Copy beside the target, then swap: a crash never leaves a half model. */
async function replaceDirectory(source: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const staging = `${target}.seeding-${randomBytes(4).toString('hex')}`;
  try {
    await fs.cp(source, staging, { recursive: true });
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(staging, target);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function readMarker(dir: string): Promise<string | null> {
  try {
    return (await fs.readFile(path.join(dir, MODEL_MARKER), 'utf8')).trim().toLowerCase();
  } catch {
    return null;
  }
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}
