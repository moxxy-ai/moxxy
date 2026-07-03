import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Baileys auth-state persistence behind a swappable storage adapter.
 *
 * Baileys' multi-device auth is a ROTATING key store (signal sessions, pre-keys,
 * sender keys, app-state sync keys) plus a creds record — dozens of small files
 * that churn constantly. That churn is why the moxxy VAULT is the wrong home for
 * it (the vault is an encrypted, tagged, human-curated secret store, not a
 * high-write key-value backend); instead the state lives in a dedicated
 * directory under the moxxy home with tight modes (dir 0700, files 0600).
 * TRADE-OFF (recorded in TECH_DEBT + the PR): unlike vault entries, these files
 * are NOT encrypted at rest — anyone with file access to the moxxy home can
 * hijack the linked WhatsApp session. The {@link WhatsAppAuthStorage} interface
 * exists precisely so an encrypted backend can be swapped in later without
 * touching the channel.
 */
export interface WhatsAppAuthStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Wipe the whole store (logout / unpair). */
  clear(): Promise<void>;
}

/** Signal key ids contain `/` and `:`; map every key to one safe flat filename. */
export function sanitizeAuthKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
}

/**
 * The default storage backend: one JSON file per key under `dir`, created 0700
 * with 0600 files so the signal identity is at least owner-only on disk.
 */
export function createFileAuthStorage(dir: string): WhatsAppAuthStorage {
  const fileFor = (key: string): string => path.join(dir, `${sanitizeAuthKey(key)}.json`);
  const ensureDir = async (): Promise<void> => {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  };
  return {
    async read(key) {
      try {
        return await fs.readFile(fileFor(key), 'utf8');
      } catch {
        return null;
      }
    },
    async write(key, value) {
      await ensureDir();
      const target = fileFor(key);
      // Write-then-rename so a crash mid-write can't truncate the creds record;
      // chmod explicitly because writeFile's mode option is masked by umask.
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, value, { mode: 0o600 });
      await fs.chmod(tmp, 0o600);
      await fs.rename(tmp, target);
    },
    async delete(key) {
      await fs.rm(fileFor(key), { force: true });
    },
    async clear() {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/** The creds record's storage key (every other key is `<type>-<id>`). */
const CREDS_KEY = 'creds';

/** True when a linked-device credential record exists (i.e. paired before). */
export async function hasStoredCreds(storage: WhatsAppAuthStorage): Promise<boolean> {
  return (await storage.read(CREDS_KEY)) != null;
}

/**
 * The tiny slice of Baileys this module needs — injected so unit tests never
 * import the real package, and so the production wiring (`baileys-socket.ts`)
 * can hand in the lazily-imported module.
 */
export interface BaileysAuthBridge {
  initAuthCreds(): Record<string, unknown>;
  readonly BufferJSON: {
    readonly reviver: (key: string, value: unknown) => unknown;
    readonly replacer: (key: string, value: unknown) => unknown;
  };
  /** `proto.Message.AppStateSyncKeyData.fromObject` — revives that one typed key
   *  category the way Baileys' own `useMultiFileAuthState` does. Optional so a
   *  fake bridge in tests can skip it. */
  readonly reviveAppStateSyncKey?: (value: unknown) => unknown;
}

export interface WhatsAppAuthState {
  /** Shaped exactly like Baileys' `AuthenticationState` (creds + keys store). */
  readonly state: {
    readonly creds: Record<string, unknown>;
    readonly keys: {
      get(type: string, ids: string[]): Promise<Record<string, unknown>>;
      set(data: Record<string, Record<string, unknown | null>>): Promise<void>;
    };
  };
  /** Persist the creds record; wire to the socket's `creds.update` event. */
  saveCreds(): Promise<void>;
}

/**
 * `useMultiFileAuthState` equivalent over a {@link WhatsAppAuthStorage} — the
 * same creds + `<type>-<id>` key layout, serialized with Baileys' BufferJSON
 * (signal keys are raw byte arrays), but with the storage backend swappable.
 */
export async function createWhatsAppAuthState(
  storage: WhatsAppAuthStorage,
  bridge: BaileysAuthBridge,
): Promise<WhatsAppAuthState> {
  const readJson = async (key: string): Promise<unknown> => {
    const raw = await storage.read(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw, bridge.BufferJSON.reviver);
    } catch {
      return null;
    }
  };
  const writeJson = (key: string, value: unknown): Promise<void> =>
    storage.write(key, JSON.stringify(value, bridge.BufferJSON.replacer));

  const creds =
    ((await readJson(CREDS_KEY)) as Record<string, unknown> | null) ?? bridge.initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const data: Record<string, unknown> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readJson(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value != null && bridge.reviveAppStateSyncKey) {
                value = bridge.reviveAppStateSyncKey(value);
              }
              if (value != null) data[id] = value;
            }),
          );
          return data;
        },
        async set(data) {
          const tasks: Promise<void>[] = [];
          for (const [category, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries)) {
              const key = `${category}-${id}`;
              tasks.push(value == null ? storage.delete(key) : writeJson(key, value));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeJson(CREDS_KEY, creds),
  };
}
