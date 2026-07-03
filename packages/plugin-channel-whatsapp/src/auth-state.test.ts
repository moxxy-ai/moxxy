import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFileAuthStorage,
  createWhatsAppAuthState,
  hasStoredCreds,
  sanitizeAuthKey,
  type BaileysAuthBridge,
  type WhatsAppAuthStorage,
} from './auth-state.js';

// A trivial bridge: identity JSON (no Buffer categories), fresh creds counter.
function fakeBridge(): BaileysAuthBridge {
  let n = 0;
  return {
    initAuthCreds: () => ({ me: `creds-${n++}` }),
    BufferJSON: { reviver: (_k, v) => v, replacer: (_k, v) => v },
  };
}

describe('sanitizeAuthKey', () => {
  it('flattens signal key ids into safe filenames', () => {
    expect(sanitizeAuthKey('pre-key-42')).toBe('pre-key-42');
    expect(sanitizeAuthKey('session-15551234567:1.0')).toBe('session-15551234567_1.0');
    expect(sanitizeAuthKey('../escape')).toBe('__escape');
  });
});

describe('createWhatsAppAuthState (over an in-memory storage)', () => {
  function memStorage(): WhatsAppAuthStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      async read(k) {
        return map.get(k) ?? null;
      },
      async write(k, v) {
        map.set(k, v);
      },
      async delete(k) {
        map.delete(k);
      },
      async clear() {
        map.clear();
      },
    };
  }

  it('creates fresh creds when none stored, and persists them via saveCreds', async () => {
    const storage = memStorage();
    const { state, saveCreds } = await createWhatsAppAuthState(storage, fakeBridge());
    expect(state.creds).toEqual({ me: 'creds-0' });
    await saveCreds();
    expect(storage.map.has('creds')).toBe(true);
    expect(await hasStoredCreds(storage)).toBe(true);
  });

  it('round-trips key set/get and honors null-delete', async () => {
    const storage = memStorage();
    const { state } = await createWhatsAppAuthState(storage, fakeBridge());
    await state.keys.set({ 'pre-key': { '1': { k: 'v' }, '2': { k: 'w' } } });
    expect(await state.keys.get('pre-key', ['1', '2'])).toEqual({ '1': { k: 'v' }, '2': { k: 'w' } });

    await state.keys.set({ 'pre-key': { '1': null } });
    expect(await state.keys.get('pre-key', ['1', '2'])).toEqual({ '2': { k: 'w' } });
  });

  it('reuses stored creds on the next init', async () => {
    const storage = memStorage();
    const bridge = fakeBridge();
    const first = await createWhatsAppAuthState(storage, bridge);
    await first.saveCreds();
    const second = await createWhatsAppAuthState(storage, bridge);
    expect(second.state.creds).toEqual({ me: 'creds-0' });
  });
});

describe('createFileAuthStorage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-auth-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes 0600 files and clears the whole dir', async () => {
    const storage = createFileAuthStorage(path.join(dir, 'auth'));
    await storage.write('creds', '{"x":1}');
    expect(await storage.read('creds')).toBe('{"x":1}');
    expect(await hasStoredCreds(storage)).toBe(true);

    const file = path.join(dir, 'auth', 'creds.json');
    const mode = (await fs.stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);

    await storage.clear();
    expect(await storage.read('creds')).toBeNull();
    expect(await hasStoredCreds(storage)).toBe(false);
  });
});
