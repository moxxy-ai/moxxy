import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { moxxyPath, PRIVATE_FILE_MODE, writeFileAtomic } from '@moxxy/sdk/server';
import { createMutex, type Mutex } from '@moxxy/sdk';

/**
 * Trust store for EXECUTABLE project configs.
 *
 * `moxxy.config.{ts,js,mjs,cjs}` is not data, it is code that the loader
 * executes with the user's full privileges before the permission engine, the
 * vault, or any isolator exists. Combined with the loader's upward walk, that
 * means `git clone` + `cd` + `moxxy` runs a stranger's code. Developers clone
 * untrusted repositories constantly, so this is the largest local-execution
 * hole in the product.
 *
 * The fix is consent, keyed to CONTENT rather than to a path: what a user
 * approved is the file they read, so editing it must ask again. Same model as
 * `direnv allow` and VS Code's workspace trust, and for the same reason: a path
 * allow-list silently re-authorizes whatever gets written there later.
 *
 * YAML configs are pure data and never pass through here.
 */

export interface TrustEntry {
  readonly path: string;
  /** SHA-256 of the file's bytes at the moment consent was given. */
  readonly sha256: string;
  readonly trustedAt: string;
}

interface TrustFile {
  readonly version: 1;
  readonly entries: ReadonlyArray<TrustEntry>;
}

const TRUST_VERSION = 1;

export function configTrustPath(): string {
  return moxxyPath('trusted-configs.json');
}

/** Content hash of a config file, or null when it cannot be read. */
export async function hashConfigFile(filePath: string): Promise<string | null> {
  try {
    const bytes = await fs.readFile(filePath);
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    return null;
  }
}

async function readTrustFile(): Promise<TrustFile> {
  try {
    const raw = await fs.readFile(configTrustPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as TrustFile).version === TRUST_VERSION &&
      Array.isArray((parsed as TrustFile).entries)
    ) {
      const entries = (parsed as TrustFile).entries.filter(
        (e): e is TrustEntry =>
          typeof e?.path === 'string' && typeof e?.sha256 === 'string' && e.sha256.length === 64,
      );
      return { version: TRUST_VERSION, entries };
    }
  } catch {
    /* missing or malformed */
  }
  // A store we cannot parse must not be read as "everything is trusted".
  return { version: TRUST_VERSION, entries: [] };
}

/**
 * Whether this exact file CONTENT has been approved. An edited config returns
 * false even though its path is on file, which is the point.
 */
export async function isConfigTrusted(filePath: string): Promise<boolean> {
  const hash = await hashConfigFile(filePath);
  if (!hash) return false;
  const { entries } = await readTrustFile();
  return entries.some((e) => e.path === filePath && e.sha256 === hash);
}

// Whole-file read-modify-write, so concurrent trusts would clobber each other.
const trustMutex: Mutex = createMutex();

/** Record consent for this file's current content. Returns the stored hash. */
export async function trustConfig(filePath: string): Promise<string> {
  const hash = await hashConfigFile(filePath);
  if (!hash) throw new Error(`cannot read config to trust it: ${filePath}`);
  await trustMutex.run(async () => {
    const { entries } = await readTrustFile();
    const next: TrustEntry[] = [
      // One entry per path: a re-trust supersedes the hash we approved before.
      ...entries.filter((e) => e.path !== filePath),
      { path: filePath, sha256: hash, trustedAt: new Date().toISOString() },
    ];
    await writeFileAtomic(
      configTrustPath(),
      JSON.stringify({ version: TRUST_VERSION, entries: next }, null, 2) + '\n',
      { mode: PRIVATE_FILE_MODE },
    );
  });
  return hash;
}

/** Withdraw consent for a path. Returns whether anything was removed. */
export async function untrustConfig(filePath: string): Promise<boolean> {
  return await trustMutex.run(async () => {
    const { entries } = await readTrustFile();
    const next = entries.filter((e) => e.path !== filePath);
    if (next.length === entries.length) return false;
    await writeFileAtomic(
      configTrustPath(),
      JSON.stringify({ version: TRUST_VERSION, entries: next }, null, 2) + '\n',
      { mode: PRIVATE_FILE_MODE },
    );
    return true;
  });
}

/** Every recorded consent, for `moxxy config trust --list`. */
export async function listTrustedConfigs(): Promise<ReadonlyArray<TrustEntry>> {
  return (await readTrustFile()).entries;
}
