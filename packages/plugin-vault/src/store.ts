import { promises as fs } from 'node:fs';
import { createMutex, MoxxyError, type Mutex } from '@moxxy/sdk';
import { writeFileAtomic } from '@moxxy/sdk/server';
import { decrypt, encrypt, generateSalt, type EncryptedBlob } from './crypto.js';
import type { MasterKeySource } from './keysource.js';

interface VaultFile {
  readonly version: 1;
  readonly kdf: 'scrypt';
  readonly salt: string;
  readonly entries: Record<string, VaultEntry>;
  /**
   * Known-plaintext probe encrypted with the master key. On open(), we
   * decrypt this to verify the user-supplied passphrase matches the one
   * used to create the file — otherwise the next `get()` would throw a
   * cryptic AES-GCM auth-tag error.
   *
   * Optional for backward compatibility: a vault written by an older
   * version of this code won't have it, in which case we fall back to
   * probing the first real entry (if any).
   */
  readonly canary?: EncryptedBlob;
}

const CANARY_PLAINTEXT = 'moxxy:vault:v1';

// Upper bound on filesystem mtime granularity (HFS+/old ext are ~1-2s). Within
// this window of "now" an unchanged (mtime,size) fingerprint can't be trusted
// to mean "no other writer", so syncFromDisk re-reads instead of fast-pathing.
const MTIME_GRANULARITY_MS = 2000;

/**
 * Thrown when the supplied passphrase doesn't match the stored vault.
 * Surfaced to the user with a recovery hint instead of the raw AES-GCM
 * "Unsupported state or unable to authenticate data" error.
 */
export class VaultPassphraseError extends Error {
  constructor(public readonly filePath: string) {
    super(
      `Wrong vault passphrase for ${filePath}.\n` +
        `  If you've forgotten it, wipe the vault and key cache, then re-run \`moxxy init\`:\n` +
        `    rm ${filePath} ~/.moxxy/vault.key\n` +
        `  (If the OS keychain holds a cached key, also clear it: \`security delete-generic-password -s moxxy\` on macOS.)\n` +
        `  Or set MOXXY_VAULT_PASSPHRASE to a known value to skip the prompt entirely.`,
    );
    this.name = 'VaultPassphraseError';
  }
}

export interface VaultEntry extends EncryptedBlob {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tags?: ReadonlyArray<string>;
}

export interface VaultEntryInfo {
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tags?: ReadonlyArray<string>;
}

export interface VaultStoreOptions {
  readonly filePath: string;
  readonly keySource: MasterKeySource;
}

export class VaultStore {
  private readonly filePath: string;
  private readonly keySource: MasterKeySource;
  private file: VaultFile | null = null;
  private masterKey: Buffer | null = null;
  // Serializes every mutator (set/delete) and persist() so concurrent
  // writers don't clobber each other through the read-modify-write +
  // whole-file rewrite. open() is also chained through this so two
  // parallel `open()` calls never both derive a fresh salt.
  private readonly mutex: Mutex = createMutex();
  // stat() fingerprint of the file as of our last load/sync/persist; lets
  // syncFromDisk() skip the read+parse when nothing else has written.
  private lastSynced: { mtimeMs: number; size: number } | null = null;

  constructor(opts: VaultStoreOptions) {
    this.filePath = opts.filePath;
    this.keySource = opts.keySource;
  }

  async open(): Promise<void> {
    if (this.file && this.masterKey) return;
    return this.mutex.run(async () => {
      if (this.file && this.masterKey) return;
      await this.load();
    });
  }

  get sourceName(): string {
    return this.keySource.name;
  }

  private async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
    if (raw === null) {
      const salt = generateSalt();
      this.masterKey = await this.obtainOwnedKey(salt);
      this.file = {
        version: 1,
        kdf: 'scrypt',
        salt: salt.toString('base64'),
        entries: {},
        canary: encrypt(CANARY_PLAINTEXT, this.masterKey),
      };
      await this.persist();
      return;
    }
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(raw);
    } catch {
      throw this.corruptError('Vault file is not valid JSON');
    }
    if (!isPlainObject(parsedRaw)) {
      throw this.corruptError('Vault file is not a JSON object');
    }
    const parsed = parsedRaw as Partial<VaultFile>;
    if (parsed.version !== 1 || parsed.kdf !== 'scrypt') {
      throw new MoxxyError({
        code: 'VAULT_CORRUPT',
        message: `Unsupported vault file: version=${String(parsed.version)} kdf=${String(parsed.kdf)}`,
        hint: `This vault was written by an incompatible version. Back up and remove ${this.filePath} to re-initialize.`,
        context: { filePath: this.filePath },
      });
    }
    if (!validateVaultFile(parsed)) {
      throw this.corruptError('Vault file is malformed (bad salt/entries/canary shape)');
    }
    this.file = parsed;
    const salt = Buffer.from(parsed.salt, 'base64');
    this.masterKey = await this.obtainOwnedKey(salt);
    this.verifyPassphrase();
    // Backfill the canary on the first successful open of a legacy vault.
    if (!this.file.canary) {
      this.file = { ...this.file, canary: encrypt(CANARY_PLAINTEXT, this.masterKey) };
      try {
        await this.persist();
      } catch {
        // Best-effort — failing to backfill doesn't break the open.
      }
    }
  }

  /**
   * Obtain the master key and return a copy the store solely owns. Key sources
   * may hand back a buffer they (or the caller) keep a reference to — copying
   * lets `close()` zero our buffer without corrupting that shared one.
   */
  private async obtainOwnedKey(salt: Buffer): Promise<Buffer> {
    return Buffer.from(await this.keySource.obtain(salt));
  }

  private corruptError(message: string): MoxxyError {
    return new MoxxyError({
      code: 'VAULT_CORRUPT',
      message,
      hint: `Back up and remove ${this.filePath} to re-initialize the vault.`,
      context: { filePath: this.filePath },
    });
  }

  /**
   * Confirm the master key decrypts the file's canary (or, for legacy
   * vaults without a canary, the first stored entry). On mismatch throw
   * a friendly `VaultPassphraseError` rather than letting the cryptic
   * "Unsupported state or unable to authenticate data" error from
   * Node's AES-GCM bubble up later.
   */
  private verifyPassphrase(): void {
    if (!this.file || !this.masterKey) return;
    const probe = this.file.canary ?? firstEntry(this.file.entries);
    if (!probe) return; // empty legacy vault — nothing to verify yet.
    try {
      const plaintext = decrypt(probe, this.masterKey);
      if (this.file.canary && plaintext !== CANARY_PLAINTEXT) {
        throw new VaultPassphraseError(this.filePath);
      }
    } catch (err) {
      if (err instanceof VaultPassphraseError) throw err;
      throw new VaultPassphraseError(this.filePath);
    }
  }

  /**
   * Fold other writers' entries in from the on-disk file. Historically the
   * vault persisted a whole-file snapshot of THIS instance's memory, so a
   * write from any other `VaultStore` (another moxxy process, or a second
   * instance in this one) was silently clobbered by our next persist —
   * last-writer-wins, fatal for single-use rotated OAuth refresh tokens.
   * Now every read and every mutation first re-reads the file (mtime/size
   * gated, so the common no-other-writer case costs one `stat`) and merges:
   *   - key on both sides → newer `updatedAt` wins (ISO timestamps);
   *   - key only on disk  → adopt it (another writer added it);
   *   - key only in memory → drop it (every mutation persists before
   *     returning, so a key missing on disk was deleted by another writer).
   * Skipped when the on-disk salt differs (vault wiped/recreated — those
   * entries are undecryptable under our master key) or the file is
   * unreadable/corrupt (keep memory; the next persist restores a good file).
   *
   * Must be called while holding `this.mutex`.
   */
  private async syncFromDisk(): Promise<void> {
    if (!this.file) return;
    let st: { mtimeMs: number; size: number };
    try {
      st = await fs.stat(this.filePath);
    } catch (err) {
      if (isEnoent(err)) return; // deleted out from under us — keep memory
      throw err;
    }
    // Fast path: skip the read+merge only when the stat fingerprint is
    // unchanged AND it has aged past the filesystem's mtime granularity. On
    // coarse-mtime filesystems (HFS+, older ext) two writes inside the same
    // ~1-2s tick that also produce an identical byte length share a
    // (mtime,size) fingerprint, so a recent match might hide a sibling write.
    // The merge is idempotent and cheap, so when in doubt we re-read.
    if (
      this.lastSynced &&
      st.mtimeMs === this.lastSynced.mtimeMs &&
      st.size === this.lastSynced.size &&
      Date.now() - st.mtimeMs > MTIME_GRANULARITY_MS
    ) {
      return;
    }
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch {
      return;
    }
    if (!isPlainObject(parsedRaw)) return;
    const parsed = parsedRaw as Partial<VaultFile>;
    if (
      parsed.version !== 1 ||
      parsed.kdf !== 'scrypt' ||
      parsed.salt !== this.file.salt ||
      !validateVaultFile(parsed)
    ) {
      return;
    }
    this.file = { ...this.file, entries: mergeEntries(this.file.entries, parsed.entries) };
    // Fingerprint from BEFORE the read: if a write landed in between, the
    // next sync simply re-reads — never the other way around.
    this.lastSynced = { mtimeMs: st.mtimeMs, size: st.size };
  }

  /**
   * Crash-atomic write: serialize to a sibling tmp file, then rename. POSIX
   * rename is atomic, so a crash mid-write leaves the previous vault intact
   * rather than truncated. mode 0o600 keeps the secret store owner-only.
   */
  private async persist(): Promise<void> {
    if (!this.file) return;
    await writeFileAtomic(this.filePath, JSON.stringify(this.file, null, 2), { mode: 0o600 });
    // Force the next syncFromDisk() to re-read rather than recording a stat
    // here: between our rename and a post-write fs.stat another process may
    // have renamed ITS version in, so the fingerprint we'd capture could be
    // a foreign file's — which would then make us skip reading the very
    // update we're out of sync with. Dropping the fingerprint costs one
    // extra (idempotent, merge-only) read on the next access.
    this.lastSynced = null;
  }

  async set(name: string, value: string, tags?: ReadonlyArray<string>): Promise<void> {
    await this.open();
    return this.mutex.run(async () => {
      if (!this.file || !this.masterKey) throw new Error('vault not open');
      await this.syncFromDisk();
      const now = new Date().toISOString();
      const existing = this.file.entries[name];
      const blob = encrypt(value, this.masterKey);
      this.file = {
        ...this.file,
        entries: {
          ...this.file.entries,
          [name]: {
            ...blob,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            tags: tags ?? existing?.tags,
          },
        },
      };
      await this.persist();
    });
  }

  async get(name: string): Promise<string | null> {
    await this.open();
    // Read the entry inside the same mutex turn as syncFromDisk so a
    // concurrent set()/delete() (which replaces this.file wholesale) can't
    // swap the snapshot out between the sync and the decrypt.
    return this.mutex.run(async () => {
      await this.syncFromDisk();
      if (!this.file || !this.masterKey) throw new Error('vault not open');
      const entry = this.file.entries[name];
      if (!entry) return null;
      return this.decryptEntry(name, entry);
    });
  }

  /**
   * Decrypt a single stored blob, converting any low-level crypto failure into
   * a friendly `VAULT_CORRUPT` error. `validateVaultFile` only guarantees the
   * blob's iv/tag/data are *strings*, not that they base64-decode to the right
   * lengths — a partially-corrupted entry (e.g. a truncated `iv` or `tag`, or a
   * value re-keyed out-of-band) passes structural validation yet makes Node's
   * AES-GCM throw a raw `ERR_CRYPTO_INVALID_IV` / `ERR_CRYPTO_INVALID_AUTH_TAG`
   * / auth-tag-mismatch error. The vault's passphrase is already verified
   * against the canary on open(), so a per-entry decrypt failure means THAT
   * entry is corrupt, not that the whole vault is locked — surface a targeted
   * recovery hint instead of crashing the caller with a cryptic crypto error.
   */
  private decryptEntry(name: string, entry: VaultEntry): string {
    try {
      return decrypt(entry, this.masterKey!);
    } catch (err) {
      throw new MoxxyError({
        code: 'VAULT_CORRUPT',
        message: `vault: entry '${name}' could not be decrypted (corrupt or re-keyed)`,
        hint: `Re-store it with \`/vault set ${name} <value>\`, or back up and remove ${this.filePath} to re-initialize.`,
        context: { filePath: this.filePath, name },
        cause: err,
      });
    }
  }

  async has(name: string): Promise<boolean> {
    await this.open();
    return this.mutex.run(async () => {
      await this.syncFromDisk();
      return Boolean(this.file?.entries[name]);
    });
  }

  async delete(name: string): Promise<boolean> {
    await this.open();
    return this.mutex.run(async () => {
      if (!this.file) return false;
      await this.syncFromDisk();
      if (!(name in this.file.entries)) return false;
      const { [name]: _removed, ...rest } = this.file.entries;
      void _removed;
      this.file = { ...this.file, entries: rest };
      await this.persist();
      return true;
    });
  }

  async list(): Promise<ReadonlyArray<VaultEntryInfo>> {
    await this.open();
    return this.mutex.run(async () => {
      await this.syncFromDisk();
      if (!this.file) return [];
      return Object.entries(this.file.entries).map(([name, e]) => ({
        name,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        tags: e.tags,
      }));
    });
  }

  /**
   * Wipe the in-memory master key and cached file so the AES key is no longer
   * recoverable from a heap/core dump or swap after the store is done. The
   * store can be reopened — `open()` re-derives the key. Returned plaintext
   * strings from `get()` cannot be wiped (JS strings are immutable); only the
   * long-lived key Buffer is zeroed here.
   */
  close(): void {
    this.masterKey?.fill(0);
    this.masterKey = null;
    this.file = null;
    this.lastSynced = null;
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/**
 * Merge our in-memory entries with another writer's on-disk entries. Disk is
 * the base (all current writers merge-before-persist, so disk is the union of
 * everyone's persisted state); when both sides hold a key, the newer
 * `updatedAt` wins so a stale whole-file write from an older moxxy can't roll
 * back a fresher value (e.g. a just-rotated OAuth refresh token).
 */
function mergeEntries(
  memory: Record<string, VaultEntry>,
  disk: Record<string, VaultEntry>,
): Record<string, VaultEntry> {
  const merged: Record<string, VaultEntry> = { ...disk };
  for (const [name, mine] of Object.entries(memory)) {
    const theirs = merged[name];
    if (theirs && theirs.updatedAt >= mine.updatedAt) continue;
    if (!theirs) continue; // absent on disk → deleted by another writer
    merged[name] = mine;
  }
  return merged;
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEncryptedBlob(v: unknown): v is EncryptedBlob {
  return (
    isPlainObject(v) &&
    typeof v.iv === 'string' &&
    typeof v.tag === 'string' &&
    typeof v.data === 'string'
  );
}

/**
 * Structural validation of a parsed vault file beyond the version/kdf gate:
 * `salt` is a string, `entries` is a plain object whose every value is a
 * well-formed encrypted blob (with createdAt/updatedAt strings), and `canary`
 * (when present) is a blob. Guards against partial writes / manual edits that
 * are valid JSON but would otherwise throw a raw TypeError in
 * verifyPassphrase()/list() instead of a friendly VAULT_CORRUPT error.
 */
function validateVaultFile(parsed: Partial<VaultFile>): parsed is VaultFile {
  if (typeof parsed.salt !== 'string') return false;
  if (!isPlainObject(parsed.entries)) return false;
  for (const entry of Object.values(parsed.entries)) {
    if (!isEncryptedBlob(entry)) return false;
    const e = entry as Partial<VaultEntry>;
    if (typeof e.createdAt !== 'string' || typeof e.updatedAt !== 'string') return false;
  }
  if (parsed.canary !== undefined && !isEncryptedBlob(parsed.canary)) return false;
  return true;
}

function firstEntry(entries: Record<string, VaultEntry>): VaultEntry | undefined {
  for (const key of Object.keys(entries)) {
    return entries[key];
  }
  return undefined;
}
