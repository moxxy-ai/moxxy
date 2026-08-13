import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { writeFileAtomic, moxxyPath } from '@moxxy/sdk/server';
import { deriveKeyAsync } from './crypto.js';

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
  /**
   * Demand a human-chosen passphrase instead of generating a key. Off by
   * default: a passphrase is a real increase in protection, but making it
   * mandatory turned first run into a hard stop on any host without an OS
   * keychain. An operator who wants the stronger posture sets
   * `vault.requirePassphrase: true` (and can lock it from the system scope).
   */
  readonly requirePassphrase?: boolean;
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
 *   4. A randomly GENERATED key, persisted for next time.
 *   5. Interactive passphrase prompt (only when a passphrase is required, or
 *      when the generated key could not be persisted).
 *
 * The first successful prompt persists the derived key to BOTH the OS keychain
 * (if available) and the disk cache so subsequent runs are silent. The chosen
 * source's name is exposed via `.name` so `moxxy doctor` can surface it
 * ("vault unlocked via keychain" / "via ~/.moxxy/vault.key").
 */
export function createCombinedKeySource(opts: CombinedKeySourceOptions): MasterKeySource {
  let resolvedName = 'unknown';
  const diskPath = resolveDiskPath(opts.diskKeyPath);
  // Memoize the env-path scrypt derivation. obtain() is called on every
  // VaultStore.open(), and scryptSync (N=16384) is a CPU-bound stall of the
  // single-threaded event loop; without this cache an env-configured process
  // re-pays the full KDF cost every time a fresh VaultStore opens. Keyed by
  // (passphrase, salt) so a salt change still re-derives. Single entry — the
  // env passphrase and the on-disk salt are stable for a process lifetime.
  let envCache: { passphrase: string; saltB64: string; key: Buffer } | null = null;
  const deriveEnvKey = async (passphrase: string, salt: Buffer): Promise<Buffer> => {
    const saltB64 = salt.toString('base64');
    if (envCache && envCache.passphrase === passphrase && envCache.saltB64 === saltB64) {
      return envCache.key;
    }
    const key = await deriveKeyAsync(passphrase, salt);
    envCache = { passphrase, saltB64, key };
    return key;
  };

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
        return await deriveEnvKey(envValue, salt);
      }

      if (!opts.disableKeytar) {
        const fromKeychain = await tryKeychainGet();
        if (fromKeychain) {
          resolvedName = 'keychain';
          // Backfill the disk cache so a future keychain outage doesn't
          // suddenly force a passphrase prompt. Awaited (both helpers swallow
          // their own errors) so the "subsequent runs are silent" guarantee
          // actually holds before obtain() resolves, and a process that exits
          // immediately after first open() still persisted the backfill.
          if (diskPath) await tryDiskSet(diskPath, fromKeychain);
          return Buffer.from(fromKeychain, 'base64');
        }
      }

      if (diskPath) {
        const fromDisk = await tryDiskGet(diskPath);
        if (fromDisk) {
          resolvedName = `file:${diskPath}`;
          // Backfill the keychain if it became available since the file was written.
          if (!opts.disableKeytar) await tryKeychainSet(fromDisk);
          return Buffer.from(fromDisk, 'base64');
        }
      }

      // Nothing stored yet. Prefer GENERATING a key over demanding a
      // passphrase: on a host with no OS keychain (a container, a headless
      // Linux box) the prompt was a hard stop, and on a non-TTY it failed
      // outright. A random 256-bit key gives the same protection against the
      // threat this vault actually addresses, which is a key leaking through
      // config in git, a transcript, or a log, rather than through a local
      // attacker who can already read a 0600 file in the user's own home.
      //
      // Only when the key can be PERSISTED, though. A generated key we cannot
      // store is unrecoverable, so every secret written under it would be lost
      // on the next run; in that case the prompt is better precisely because
      // the user can reproduce it from memory.
      if (!opts.requirePassphrase) {
        const generated = randomBytes(32);
        const b64 = generated.toString('base64');
        await persistKey(b64);
        if (await keyIsRetrievableFrom(diskPath, b64, !opts.disableKeytar)) {
          resolvedName = 'generated';
          return generated;
        }
      }

      const passphrase = await opts.passphrasePrompt();
      resolvedName = 'passphrase';
      const key = await deriveKeyAsync(passphrase, salt);
      await persistKey(key.toString('base64'));
      return key;
    },
    async persist(key) {
      await persistKey(key.toString('base64'));
    },
  };
}

/**
 * Confirm a just-persisted key can actually be read back.
 *
 * `persistKey` is best-effort on both the keychain and the disk cache, so a
 * silent failure would leave a generated key in memory only, and every secret
 * written under it unrecoverable on the next run. Checking is the difference
 * between "encrypted with a key we kept" and quiet data loss.
 */
async function keyIsRetrievableFrom(
  diskPath: string | null,
  expected: string,
  useKeychain: boolean,
): Promise<boolean> {
  if (useKeychain && (await tryKeychainGet()) === expected) return true;
  if (!diskPath) return false;
  return (await tryDiskGet(diskPath)) === expected;
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
