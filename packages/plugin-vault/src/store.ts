import { promises as fs } from 'node:fs';
import { writeFileAtomic, createMutex, type Mutex } from '@moxxy/sdk';
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
      this.masterKey = await this.keySource.obtain(salt);
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
    const parsed = JSON.parse(raw) as VaultFile;
    if (parsed.version !== 1 || parsed.kdf !== 'scrypt') {
      throw new Error(`Unsupported vault file: version=${parsed.version} kdf=${parsed.kdf}`);
    }
    this.file = parsed;
    const salt = Buffer.from(parsed.salt, 'base64');
    this.masterKey = await this.keySource.obtain(salt);
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
   * Crash-atomic write: serialize to a sibling tmp file, then rename. POSIX
   * rename is atomic, so a crash mid-write leaves the previous vault intact
   * rather than truncated. mode 0o600 keeps the secret store owner-only.
   */
  private async persist(): Promise<void> {
    if (!this.file) return;
    await writeFileAtomic(this.filePath, JSON.stringify(this.file, null, 2), { mode: 0o600 });
  }

  async set(name: string, value: string, tags?: ReadonlyArray<string>): Promise<void> {
    await this.open();
    return this.mutex.run(async () => {
      if (!this.file || !this.masterKey) throw new Error('vault not open');
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
    if (!this.file || !this.masterKey) throw new Error('vault not open');
    const entry = this.file.entries[name];
    if (!entry) return null;
    return decrypt(entry, this.masterKey);
  }

  async has(name: string): Promise<boolean> {
    await this.open();
    return Boolean(this.file?.entries[name]);
  }

  async delete(name: string): Promise<boolean> {
    await this.open();
    return this.mutex.run(async () => {
      if (!this.file) return false;
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
    if (!this.file) return [];
    return Object.entries(this.file.entries).map(([name, e]) => ({
      name,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      tags: e.tags,
    }));
  }
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function firstEntry(entries: Record<string, VaultEntry>): VaultEntry | undefined {
  for (const key of Object.keys(entries)) {
    return entries[key];
  }
  return undefined;
}
