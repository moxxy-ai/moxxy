import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import type { ChannelDef } from '@moxxy/sdk';
import { buildWhatsAppPlugin } from './index.js';
import {
  WHATSAPP_ALLOWED_JIDS_KEY,
  WHATSAPP_CONSENT_ENV,
  WHATSAPP_CONSENT_KEY,
  WHATSAPP_OWNER_JID_KEY,
} from './keys.js';

let tmp: string;
let vault: VaultStore;
let def: ChannelDef;
let writeOut: string[];
let writeErr: string[];
let origOut: typeof process.stdout.write;
let origErr: typeof process.stderr.write;
let origHome: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-wa-sub-'));
  // Point the moxxy home at the tmp dir so `hasStoredCreds` reads an empty dir.
  origHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = tmp;
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  def = (buildWhatsAppPlugin({ vault }).channels ?? [])[0] as ChannelDef;
  writeOut = [];
  writeErr = [];
  origOut = process.stdout.write.bind(process.stdout);
  origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string | Uint8Array) => {
    writeOut.push(typeof c === 'string' ? c : Buffer.from(c).toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => {
    writeErr.push(typeof c === 'string' ? c : Buffer.from(c).toString());
    return true;
  }) as typeof process.stderr.write;
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  process.stdout.write = origOut;
  process.stderr.write = origErr;
  if (origHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = origHome;
  delete process.env[WHATSAPP_CONSENT_ENV];
});

function ctx(overrides: { startChannel?: () => Promise<number> } = {}) {
  return {
    deps: { cwd: tmp, vault, logger: undefined, options: {} },
    args: { positional: [], flags: {} },
    startChannel: overrides.startChannel ?? (async () => 0),
    session: { setPermissionResolver: () => {} },
  } as never;
}

describe('whatsapp channel def', () => {
  it('declares dedicatedRunner + whatsapp session source + qr connect', () => {
    expect(def.name).toBe('whatsapp');
    expect(def.dedicatedRunner).toBe(true);
    expect(def.sessionSource).toBe('whatsapp');
    expect(def.config?.connect?.kind).toBe('qr');
    expect(def.config?.hasRequestUrl).toBe(false);
    expect(def.interactiveCommand).toBe('setup');
  });

  it('exposes setup, pair, status, unpair subcommands', () => {
    expect(Object.keys(def.subcommands ?? {})).toEqual(
      expect.arrayContaining(['setup', 'pair', 'status', 'unpair']),
    );
  });

  it('description carries the unofficial-API warning', () => {
    expect(def.description).toMatch(/UNOFFICIAL/i);
    expect(def.description).toMatch(/ban/i);
  });
});

describe('isAvailable (consent gate + link state)', () => {
  it('is unavailable without consent, naming the ToS risk', async () => {
    const avail = await def.isAvailable?.({ cwd: tmp, vault });
    expect(avail?.ok).toBe(false);
    expect(avail?.reason).toMatch(/ToS|acknowledg|ban/i);
  });

  it('is unavailable-but-needs-pairing once consent is given', async () => {
    process.env[WHATSAPP_CONSENT_ENV] = 'yes';
    const avail = await def.isAvailable?.({ cwd: tmp, vault });
    expect(avail?.ok).toBe(false);
    expect(avail?.reason).toMatch(/pair/i);
  });
});

describe('status subcommand', () => {
  it('reports needs-consent when nothing configured', async () => {
    const code = await def.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed.state).toBe('needs-consent');
    expect(parsed.consentAcknowledged).toBe(false);
    expect(parsed.linked).toBe(false);
  });

  it('reports needs-pairing after consent but before linking', async () => {
    await vault.set(WHATSAPP_CONSENT_KEY, 'acknowledged@2026-01-01T00:00:00.000Z');
    const code = await def.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed.state).toBe('needs-pairing');
    expect(parsed.guidance).toMatch(/pair/i);
  });

  it('surfaces stored allow-list + owner jid', async () => {
    await vault.set(WHATSAPP_CONSENT_KEY, 'yes');
    await vault.set(WHATSAPP_OWNER_JID_KEY, '15550000000@s.whatsapp.net');
    await vault.set(WHATSAPP_ALLOWED_JIDS_KEY, JSON.stringify(['15551111111@s.whatsapp.net']));
    const code = await def.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed.ownerJid).toBe('15550000000@s.whatsapp.net');
    expect(parsed.allowedJids).toEqual(['15551111111@s.whatsapp.net']);
  });

  it('returns 1 when the vault is unavailable', async () => {
    const badCtx = {
      deps: { cwd: tmp, vault: undefined, logger: undefined, options: {} },
      args: { positional: [], flags: {} },
      startChannel: async () => 0,
      session: { setPermissionResolver: () => {} },
    } as never;
    const code = await def.subcommands?.status?.run(badCtx);
    expect(code).toBe(1);
    expect(writeErr.join('')).toContain('vault unavailable');
  });
});

describe('unpair subcommand', () => {
  it('is a no-op when nothing is linked', async () => {
    const code = await def.subcommands?.unpair?.run(ctx());
    expect(code).toBe(0);
    expect(writeOut.join('')).toContain('no linked account');
  });
});

describe('pair subcommand', () => {
  it('refuses without a TTY (QR needs a terminal)', async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const code = await def.subcommands?.pair?.run(ctx({ startChannel }));
      expect(code).toBe(1);
      expect(startChannel).not.toHaveBeenCalled();
      expect(writeErr.join('')).toMatch(/TTY/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
    }
  });
});

describe('setup subcommand (headless)', () => {
  it('refuses to start headless without consent', async () => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const code = await def.subcommands?.setup?.run(ctx({ startChannel }));
      expect(code).toBe(1);
      expect(startChannel).not.toHaveBeenCalled();
      expect(writeErr.join('')).toMatch(/acknowledg|ToS|ban/i);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
    }
  });

  it('starts the channel headless once consent is acknowledged', async () => {
    process.env[WHATSAPP_CONSENT_ENV] = 'yes';
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const code = await def.subcommands?.setup?.run(ctx({ startChannel }));
      expect(code).toBe(0);
      expect(startChannel).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true });
    }
  });
});
