import { promises as fs } from 'node:fs';
import { writeFileAtomic, moxxyPath } from '@moxxy/sdk/server';
import { deriveKey } from './crypto.js';

const KEYCHAIN_SERVICE = 'moxxy';
const KEYCHAIN_ACCOUNT = 'vault-master-key';

export interface MasterKeySource {
  /** Returns the raw 32-byte AES key. May open a keychain or prompt the user. */
  obtain(salt: Buffer): Promise<Buffer>;
  /**
   * Force-persist a master key obtained out-of-band for future sessions.
   *
   * NB: `VaultStore` does NOT call this — `obtain()` already persists the key
   * as a side effect on the passphrase-prompt path, so the running system
   * never needs it. It exists as a forced-rewrite hook for callers that hold a
   * key themselves (e.g. a hypothetical `moxxy doctor --reseed`). Optional, so
   * sources that can't persist (env/static) simply omit it.
   */
  persist?(key: Buffer, salt: Buffer): Promise<void>;
  readonly name: string;
}

export interface CombinedKeySourceOptions {
  readonly passphrasePrompt: () => Promise<string>;
  readonly envVar?: string;
  /**
   * Skip the OS keychain (`@napi-rs/keyring`) entirely, using only the disk
   * cache + passphrase. Named `disableKeytar` for backwards compatibility —
   * the underlying keychain library is now `@napi-rs/keyring`, not keytar.
   */
  readonly disableKeytar?: boolean;
  /**
   * Disk fallback for the master key, used when the OS keychain isn't
   * available (no native binary, or it refuses to bind — common on headless
   * Linux). Stored as base64 at this path with mode 0o600 — less secure than
   * the OS keychain, but means the user types their passphrase ONCE instead
   * of every run. Set to false to disable.
   *
   * Default: `~/.moxxy/vault.key`.
   */
  readonly diskKeyPath?: string | false;
}

/**
 * Resolves the vault master key in priority order:
 *   1. `MOXXY_VAULT_PASSPHRASE` env var (derive on each call — no persistence).
 *   2. OS keychain via `@napi-rs/keyring`.
 *   3. On-disk cached key at `~/.moxxy/vault.key` (mode 0600).
 *   4. Interactive passphrase prompt.
 *
 * The first successful prompt persists the derived key to BOTH the OS keychain
 * (if available) and the disk cache so subsequent runs are silent. The chosen
 * source's name is exposed via `.name` so `moxxy doctor` can surface it
 * ("vault unlocked via keychain" / "via ~/.moxxy/vault.key").
 */
export function createCombinedKeySource(opts: CombinedKeySourceOptions): MasterKeySource {
  let resolvedName = 'unknown';
  const diskPath = resolveDiskPath(opts.diskKeyPath);

  const persistKey = async (keyB64: string): Promise<void> => {
    if (!opts.disableKeytar) await tryKeychainSet(keyB64);
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
        const fromKeychain = await tryKeychainGet();
        if (fromKeychain) {
          resolvedName = 'keychain';
          // Backfill the disk cache so a future keychain outage doesn't
          // suddenly force a passphrase prompt.
          if (diskPath) void tryDiskSet(diskPath, fromKeychain);
          return Buffer.from(fromKeychain, 'base64');
        }
      }

      if (diskPath) {
        const fromDisk = await tryDiskGet(diskPath);
        if (fromDisk) {
          resolvedName = `file:${diskPath}`;
          // Backfill the keychain if it became available since the file was written.
          if (!opts.disableKeytar) void tryKeychainSet(fromDisk);
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

/**
 * Minimal shape of the `@napi-rs/keyring` `Entry` we rely on. The library is
 * a dynamic, optional import: it ships prebuilt native binaries per platform,
 * but if it isn't installed (or its binary is missing) we fall back to the
 * disk cache / passphrase rather than failing. Unlike keytar, `getPassword()`
 * is synchronous and THROWS when no entry exists — both are handled by the
 * surrounding try/catch.
 */
interface KeyringEntry {
  getPassword(): string;
  setPassword(password: string): void;
}
type KeyringModule = {
  Entry?: new (service: string, account: string) => KeyringEntry;
};

async function tryKeychainGet(): Promise<string | null> {
  try {
    const mod = (await import('@napi-rs/keyring')) as KeyringModule;
    if (!mod.Entry) return null;
    return new mod.Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).getPassword() || null;
  } catch {
    // Not installed, no stored entry, or keychain locked — fall back.
    return null;
  }
}

async function tryKeychainSet(value: string): Promise<void> {
  try {
    const mod = (await import('@napi-rs/keyring')) as KeyringModule;
    if (!mod.Entry) return;
    new mod.Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).setPassword(value);
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
