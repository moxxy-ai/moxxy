import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { decrypt, encrypt, generateSalt, type EncryptedBlob } from './crypto.js';
import type { MasterKeySource } from './keysource.js';

interface VaultFile {
  readonly version: 1;
  readonly kdf: 'scrypt';
  readonly salt: string;
  readonly entries: Record<string, VaultEntry>;
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
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(opts: VaultStoreOptions) {
    this.filePath = opts.filePath;
    this.keySource = opts.keySource;
  }

  async open(): Promise<void> {
    if (this.file && this.masterKey) return;
    return this.serialize(async () => {
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
      this.file = { version: 1, kdf: 'scrypt', salt: salt.toString('base64'), entries: {} };
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
  }

  /**
   * Crash-atomic write: serialize to a sibling tmp file, then rename. POSIX
   * rename is atomic, so a crash mid-write leaves the previous vault intact
   * rather than truncated.
   */
  private async persist(): Promise<void> {
    if (!this.file) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** Run `fn` under the per-instance mutex. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    // Keep the chain alive even if `fn` rejects, so subsequent calls aren't
    // poisoned by a single failure.
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async set(name: string, value: string, tags?: ReadonlyArray<string>): Promise<void> {
    await this.open();
    return this.serialize(async () => {
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
    return this.serialize(async () => {
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
