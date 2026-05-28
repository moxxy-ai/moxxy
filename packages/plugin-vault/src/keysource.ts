import { promises as fs } from 'node:fs';
import { writeFileAtomic, moxxyPath } from '@moxxy/sdk';
import { deriveKey } from './crypto.js';

const KEYTAR_SERVICE = 'moxxy';
const KEYTAR_ACCOUNT = 'vault-master-key';

export interface MasterKeySource {
  /** Returns the raw 32-byte AES key. May open a keychain or prompt the user. */
  obtain(salt: Buffer): Promise<Buffer>;
  /** Persist the master key (or its derivation seed) for future sessions. */
  persist?(key: Buffer, salt: Buffer): Promise<void>;
  readonly name: string;
}

export interface CombinedKeySourceOptions {
  readonly passphrasePrompt: () => Promise<string>;
  readonly envVar?: string;
  readonly disableKeytar?: boolean;
  /**
   * Disk fallback for the master key, used when keytar isn't installed
   * or refuses to bind to a keychain (common on headless Linux). Stored
   * as base64 at this path with mode 0o600 — less secure than the OS
   * keychain, but means the user types their passphrase ONCE instead of
   * every run. Set to false to disable.
   *
   * Default: `~/.moxxy/vault.key`.
   */
  readonly diskKeyPath?: string | false;
}

/**
 * Resolves the vault master key in priority order:
 *   1. `MOXXY_VAULT_PASSPHRASE` env var (derive on each call — no persistence).
 *   2. OS keychain via keytar.
 *   3. On-disk cached key at `~/.moxxy/vault.key` (mode 0600).
 *   4. Interactive passphrase prompt.
 *
 * The first successful prompt persists the derived key to BOTH keytar (if
 * available) and the disk cache so subsequent runs are silent. The chosen
 * source's name is exposed via `.name` so `moxxy doctor` can surface it
 * ("vault unlocked via keytar" / "via ~/.moxxy/vault.key").
 */
export function createCombinedKeySource(opts: CombinedKeySourceOptions): MasterKeySource {
  let resolvedName = 'unknown';
  const diskPath = resolveDiskPath(opts.diskKeyPath);

  const persistKey = async (keyB64: string): Promise<void> => {
    if (!opts.disableKeytar) await tryKeytarSet(keyB64);
    if (diskPath) await tryDiskSet(diskPath, keyB64);
  };

  return {
    get name() {
      return resolvedName;
    },
    async obtain(salt) {
      const envName = opts.envVar ?? 'MOXXY_VAULT_PASSPHRASE';
      const envValue = process.env[envName];
      if (envValue) {
        resolvedName = `env:${envName}`;
        return deriveKey(envValue, salt);
      }

      if (!opts.disableKeytar) {
        const fromKeychain = await tryKeytarGet();
        if (fromKeychain) {
          resolvedName = 'keytar';
          // Backfill the disk cache so a future keytar outage doesn't
          // suddenly force a passphrase prompt.
          if (diskPath) void tryDiskSet(diskPath, fromKeychain);
          return Buffer.from(fromKeychain, 'base64');
        }
      }

      if (diskPath) {
        const fromDisk = await tryDiskGet(diskPath);
        if (fromDisk) {
          resolvedName = `file:${diskPath}`;
          // Backfill keytar if it became available since the file was written.
          if (!opts.disableKeytar) void tryKeytarSet(fromDisk);
          return Buffer.from(fromDisk, 'base64');
        }
      }

      const passphrase = await opts.passphrasePrompt();
      resolvedName = 'passphrase';
      const key = deriveKey(passphrase, salt);
      await persistKey(key.toString('base64'));
      return key;
    },
    async persist(key) {
      await persistKey(key.toString('base64'));
    },
  };
}

function resolveDiskPath(supplied: string | false | undefined): string | null {
  if (supplied === false) return null;
  if (typeof supplied === 'string') return supplied;
  return moxxyPath('vault.key');
}

async function tryDiskGet(filePath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.trim() || null;
  } catch {
    return null;
  }
}

async function tryDiskSet(filePath: string, value: string): Promise<void> {
  try {
    // Crash-atomic, owner-only (0o600) — this is the cached master key.
    await writeFileAtomic(filePath, value + '\n', { mode: 0o600 });
  } catch {
    // Best-effort; if we can't write, the next run will just re-prompt.
  }
}

async function tryKeytarGet(): Promise<string | null> {
  try {
    const mod = (await import('keytar')) as {
      getPassword?: (svc: string, acct: string) => Promise<string | null>;
      default?: { getPassword: (svc: string, acct: string) => Promise<string | null> };
    };
    const fn = mod.getPassword ?? mod.default?.getPassword;
    if (!fn) return null;
    return await fn(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  } catch {
    return null;
  }
}

async function tryKeytarSet(value: string): Promise<void> {
  try {
    const mod = (await import('keytar')) as {
      setPassword?: (svc: string, acct: string, password: string) => Promise<void>;
      default?: { setPassword: (svc: string, acct: string, password: string) => Promise<void> };
    };
    const fn = mod.setPassword ?? mod.default?.setPassword;
    if (!fn) return;
    await fn(KEYTAR_SERVICE, KEYTAR_ACCOUNT, value);
  } catch {
    // Best-effort; keychain failures must not break the vault.
  }
}

export function createStaticKeySource(key: Buffer): MasterKeySource {
  return {
    name: 'static',
    async obtain() {
      return key;
    },
  };
}
