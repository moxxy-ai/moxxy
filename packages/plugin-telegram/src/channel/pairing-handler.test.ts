import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { TELEGRAM_AUTHORIZED_CHAT_KEY } from '../keys.js';
import { PairingHandler } from './pairing-handler.js';

let tmp: string;
let vault: VaultStore;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-tg-pair-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('PairingHandler.authorizedChatId (where the bot reaches its owner)', () => {
  it('is the paired chat restored from the vault', async () => {
    await vault.set(TELEGRAM_AUTHORIZED_CHAT_KEY, '42');
    const pairing = new PairingHandler({ vault });

    await pairing.loadAuthorized();

    expect(pairing.authorizedChatId()).toBe(42);
  });

  it('is null while no chat is paired', async () => {
    const pairing = new PairingHandler({ vault });
    await pairing.loadAuthorized();
    expect(pairing.authorizedChatId()).toBeNull();
  });
});
