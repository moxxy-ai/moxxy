import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import type { ChannelDef } from '@moxxy/sdk';
import { buildImessagePlugin } from './index.js';
import {
  IMESSAGE_ALLOWED_HANDLES_KEY,
  IMESSAGE_OWNER_HANDLES_KEY,
  IMESSAGE_SERVER_PASSWORD_KEY,
  IMESSAGE_SERVER_URL_KEY,
} from './keys.js';

let tmp: string;
let vault: VaultStore;
let def: ChannelDef;
let writeOut: string[];
let writeErr: string[];
let origStdoutWrite: typeof process.stdout.write;
let origStderrWrite: typeof process.stderr.write;
const origPlatform = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-imsg-sub-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  const plugin = buildImessagePlugin({ vault });
  const channels = plugin.channels ?? [];
  def = channels[0] as ChannelDef;
  writeOut = [];
  writeErr = [];
  origStdoutWrite = process.stdout.write.bind(process.stdout);
  origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writeOut.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writeErr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;
  vi.stubEnv('MOXXY_IMESSAGE_SERVER_URL', '');
  vi.stubEnv('MOXXY_IMESSAGE_SERVER_PASSWORD', '');
});

afterEach(async () => {
  process.stdout.write = origStdoutWrite;
  process.stderr.write = origStderrWrite;
  setPlatform(origPlatform);
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

function ctx(overrides: { startChannel?: () => Promise<number> } = {}) {
  return {
    deps: { cwd: tmp, vault, logger: undefined, options: {} },
    args: { positional: [], flags: {} },
    startChannel: overrides.startChannel ?? (async () => 0),
    session: { setPermissionResolver: () => {} },
  } as never;
}

describe('imessage ChannelDef shape', () => {
  it('declares a dedicated runner with the imessage session source', () => {
    expect(def.name).toBe('imessage');
    expect(def.dedicatedRunner).toBe(true);
    expect(def.sessionSource).toBe('imessage');
    expect(def.interactiveCommand).toBe('setup');
    expect(Object.keys(def.subcommands ?? {})).toEqual(
      expect.arrayContaining(['setup', 'status', 'unpair']),
    );
    expect(Object.keys(def.subcommands ?? {})).not.toContain('pair');
    expect(def.config?.fields.map((f) => f.vaultKey)).toEqual([
      IMESSAGE_SERVER_URL_KEY,
      IMESSAGE_SERVER_PASSWORD_KEY,
    ]);
    expect(def.config?.connect?.kind).toBe('instructions');
    expect(def.config?.hasRequestUrl).toBeFalsy();
    // The password field is the only secret; the URL is plain text.
    const password = def.config?.fields.find((f) => f.vaultKey === IMESSAGE_SERVER_PASSWORD_KEY);
    expect(password?.secret).toBe(true);
  });
});

describe('isAvailable', () => {
  it('is unavailable off macOS (never throws)', async () => {
    setPlatform('linux');
    const availability = await def.isAvailable?.({ cwd: tmp, vault });
    expect(availability?.ok).toBe(false);
    expect(availability?.reason).toMatch(/macOS/);
  });

  it('asks for configuration on macOS when nothing is stored', async () => {
    setPlatform('darwin');
    const availability = await def.isAvailable?.({ cwd: tmp, vault });
    expect(availability?.ok).toBe(false);
    expect(availability?.reason).toMatch(/imessage setup/);
  });

  it('is available on macOS with the env pair set', async () => {
    setPlatform('darwin');
    vi.stubEnv('MOXXY_IMESSAGE_SERVER_URL', 'http://localhost:1234');
    vi.stubEnv('MOXXY_IMESSAGE_SERVER_PASSWORD', 'secret');
    const availability = await def.isAvailable?.({ cwd: tmp, vault });
    expect(availability).toEqual({ ok: true });
  });

  it('is available on macOS with the vault pair set', async () => {
    setPlatform('darwin');
    await vault.set(IMESSAGE_SERVER_URL_KEY, 'http://localhost:1234');
    await vault.set(IMESSAGE_SERVER_PASSWORD_KEY, 'secret');
    const availability = await def.isAvailable?.({ cwd: tmp, vault });
    expect(availability).toEqual({ ok: true });
  });
});

describe('imessage channel subcommands', () => {
  it('`status` reports unconfigured state as JSON', async () => {
    const code = await def.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed.serverUrl).toBeNull();
    expect(parsed.passwordSet).toBe(false);
    expect(parsed.allowedHandles).toEqual([]);
    expect(parsed.ownerHandles).toEqual([]);
    expect(parsed.supported).toBe(process.platform === 'darwin');
  });

  it('`status` surfaces the stored server + allow-list (never the password)', async () => {
    await vault.set(IMESSAGE_SERVER_URL_KEY, 'http://localhost:1234');
    await vault.set(IMESSAGE_SERVER_PASSWORD_KEY, 'super-secret');
    await vault.set(IMESSAGE_ALLOWED_HANDLES_KEY, JSON.stringify(['+14440002222']));
    await vault.set(IMESSAGE_OWNER_HANDLES_KEY, JSON.stringify(['+19998887777']));
    const code = await def.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const out = writeOut.join('');
    expect(out).not.toContain('super-secret');
    const parsed = JSON.parse(out);
    expect(parsed.serverUrl).toBe('http://localhost:1234');
    expect(parsed.passwordSet).toBe(true);
    expect(parsed.allowedHandles).toEqual(['+14440002222']);
    expect(parsed.ownerHandles).toEqual(['+19998887777']);
  });

  it('`unpair` clears server config + handle lists', async () => {
    await vault.set(IMESSAGE_SERVER_URL_KEY, 'http://localhost:1234');
    await vault.set(IMESSAGE_SERVER_PASSWORD_KEY, 'secret');
    await vault.set(IMESSAGE_ALLOWED_HANDLES_KEY, JSON.stringify(['+14440002222']));
    const code = await def.subcommands?.unpair?.run(ctx());
    expect(code).toBe(0);
    expect(writeOut.join('')).toContain('unpaired');
    expect(await vault.get(IMESSAGE_SERVER_URL_KEY)).toBeNull();
    expect(await vault.get(IMESSAGE_SERVER_PASSWORD_KEY)).toBeNull();
    expect(await vault.get(IMESSAGE_ALLOWED_HANDLES_KEY)).toBeNull();
  });

  it('`unpair` is a no-op when nothing is configured', async () => {
    const code = await def.subcommands?.unpair?.run(ctx());
    expect(code).toBe(0);
    expect(writeOut.join('')).toContain('no BlueBubbles server was configured');
  });

  it('`setup` starts the channel directly when headless', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const code = await def.subcommands?.setup?.run(ctx({ startChannel }));
      expect(code).toBe(0);
      expect(startChannel).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('subcommands return 1 when the vault is unavailable', async () => {
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
