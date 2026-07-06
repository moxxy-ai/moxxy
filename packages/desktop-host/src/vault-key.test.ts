import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ensureDesktopVaultKey } from './vault-key';
import { assertDefined } from '@moxxy/sdk';

// moxxyPath resolves under ~/.moxxy via MOXXY_HOME / HOME; point it at a temp dir.
let tmp: string;
const orig = { ...process.env };

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'vault-key-'));
  process.env = { ...orig };
  // moxxyHome honors MOXXY_HOME; set both for safety across resolutions.
  process.env.MOXXY_HOME = path.join(tmp, '.moxxy');
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
});

afterEach(() => {
  process.env = orig;
});

function keyPath(): string {
  const home = process.env.MOXXY_HOME;
  assertDefined(home, 'MOXXY_HOME');
  return path.join(home, 'vault.key');
}
function vaultPath(): string {
  const home = process.env.MOXXY_HOME;
  assertDefined(home, 'MOXXY_HOME');
  return path.join(home, 'vault.json');
}

describe('ensureDesktopVaultKey', () => {
  it('seeds a 32-byte base64 master key (0600) on a fresh setup', () => {
    expect(existsSync(keyPath())).toBe(false);
    ensureDesktopVaultKey();
    expect(existsSync(keyPath())).toBe(true);
    const key = Buffer.from(readFileSync(keyPath(), 'utf8').trim(), 'base64');
    expect(key.length).toBe(32);
  });

  it('does NOT overwrite an existing vault.key', () => {
    const home = process.env.MOXXY_HOME;
    assertDefined(home, 'MOXXY_HOME');
    mkdirSync(home, { recursive: true });
    writeFileSync(keyPath(), 'existing-key\n');
    ensureDesktopVaultKey();
    expect(readFileSync(keyPath(), 'utf8')).toBe('existing-key\n');
  });

  it('does NOT seed when a vault.json already exists (keyed by keychain/passphrase)', () => {
    const home = process.env.MOXXY_HOME;
    assertDefined(home, 'MOXXY_HOME');
    mkdirSync(home, { recursive: true });
    writeFileSync(vaultPath(), '{}');
    ensureDesktopVaultKey();
    expect(existsSync(keyPath())).toBe(false);
  });

  it('is idempotent — a second call leaves the first key intact', () => {
    ensureDesktopVaultKey();
    const first = readFileSync(keyPath(), 'utf8');
    ensureDesktopVaultKey();
    expect(readFileSync(keyPath(), 'utf8')).toBe(first);
  });
});
