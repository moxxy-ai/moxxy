import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import type { ChannelDef } from '@moxxy/sdk';
import { buildSignalPlugin } from './index.js';
import { SIGNAL_ACCOUNT_KEY, SIGNAL_ALLOWED_SENDERS_KEY } from './keys.js';

let tmp: string;
let vault: VaultStore;
let signalDef: ChannelDef;
let writeOut: string[];
let writeErr: string[];
let origStdoutWrite: typeof process.stdout.write;
let origStderrWrite: typeof process.stderr.write;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-sig-sub-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  const plugin = buildSignalPlugin({ vault });
  signalDef = plugin.channels![0]!;
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
  // Tests must never find a REAL signal-cli (CI may or may not have one).
  vi.stubEnv('PATH', tmp);
  vi.stubEnv('MOXXY_SIGNAL_ACCOUNT', '');
});

afterEach(async () => {
  process.stdout.write = origStdoutWrite;
  process.stderr.write = origStderrWrite;
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

function ctx(
  overrides: {
    startChannel?: () => Promise<number>;
    session?: { setPermissionResolver: (r: unknown) => void };
  } = {},
) {
  return {
    deps: { cwd: tmp, vault, logger: undefined, options: {} },
    args: { positional: [], flags: {} },
    startChannel: overrides.startChannel ?? (async () => 0),
    session: overrides.session ?? { setPermissionResolver: () => {} },
  } as never;
}

describe('signal ChannelDef shape', () => {
  it('declares a dedicated runner with the signal session source', () => {
    expect(signalDef.name).toBe('signal');
    expect(signalDef.dedicatedRunner).toBe(true);
    expect(signalDef.sessionSource).toBe('signal');
    expect(signalDef.interactiveCommand).toBe('setup');
    expect(Object.keys(signalDef.subcommands!)).toEqual(
      expect.arrayContaining(['setup', 'pair', 'status', 'unpair']),
    );
    expect(signalDef.config?.fields.map((f) => f.vaultKey)).toEqual([SIGNAL_ACCOUNT_KEY]);
    expect(signalDef.config?.connect?.kind).toBe('qr');
  });
});

describe('isAvailable', () => {
  it('returns an install hint (never throws) when signal-cli is missing', async () => {
    const availability = await signalDef.isAvailable!({ cwd: tmp, vault });
    expect(availability.ok).toBe(false);
    expect(availability.reason).toMatch(/brew install signal-cli/);
  });

  it('asks for an account once the binary exists', async () => {
    fsSync.writeFileSync(path.join(tmp, 'signal-cli'), '#!/bin/sh\n', { mode: 0o755 });
    const availability = await signalDef.isAvailable!({ cwd: tmp, vault });
    expect(availability.ok).toBe(false);
    expect(availability.reason).toMatch(/signal setup/);
  });

  it('is available with binary + env account', async () => {
    fsSync.writeFileSync(path.join(tmp, 'signal-cli'), '#!/bin/sh\n', { mode: 0o755 });
    vi.stubEnv('MOXXY_SIGNAL_ACCOUNT', '+15551234567');
    const availability = await signalDef.isAvailable!({ cwd: tmp, vault });
    expect(availability).toEqual({ ok: true });
  });

  it('is available with binary + vault account', async () => {
    fsSync.writeFileSync(path.join(tmp, 'signal-cli'), '#!/bin/sh\n', { mode: 0o755 });
    await vault.set(SIGNAL_ACCOUNT_KEY, '+15551234567');
    const availability = await signalDef.isAvailable!({ cwd: tmp, vault });
    expect(availability).toEqual({ ok: true });
  });
});

describe('signal channel subcommands', () => {
  it('`status` reports unconfigured state as JSON', async () => {
    const code = await signalDef.subcommands!.status!.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed).toEqual({
      binaryFound: false,
      account: null,
      linked: null,
      allowedSenders: [],
      dataDir: expect.stringContaining('signal-cli'),
    });
  });

  it('`status` surfaces the stored account + allow-list', async () => {
    await vault.set(SIGNAL_ACCOUNT_KEY, '+15551234567');
    await vault.set(SIGNAL_ALLOWED_SENDERS_KEY, JSON.stringify(['+14440002222']));
    const code = await signalDef.subcommands!.status!.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed.account).toBe('+15551234567');
    expect(parsed.allowedSenders).toEqual(['+14440002222']);
  });

  it('`unpair` clears account + allow-list and points at the phone for full unlink', async () => {
    await vault.set(SIGNAL_ACCOUNT_KEY, '+15551234567');
    await vault.set(SIGNAL_ALLOWED_SENDERS_KEY, JSON.stringify(['+14440002222']));
    const code = await signalDef.subcommands!.unpair!.run(ctx());
    expect(code).toBe(0);
    expect(writeOut.join('')).toContain('unpaired');
    expect(writeOut.join('')).toContain('Linked Devices');
    expect(await vault.get(SIGNAL_ACCOUNT_KEY)).toBeNull();
    expect(await vault.get(SIGNAL_ALLOWED_SENDERS_KEY)).toBeNull();
  });

  it('`unpair` is a no-op when nothing is configured', async () => {
    const code = await signalDef.subcommands!.unpair!.run(ctx());
    expect(code).toBe(0);
    expect(writeOut.join('')).toContain('no account was configured');
  });

  it('`pair` refuses to start without a TTY (interactive-only flow)', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const code = await signalDef.subcommands!.pair!.run(ctx({ startChannel }));
      expect(code).toBe(1);
      expect(startChannel).not.toHaveBeenCalled();
      expect(writeErr.join('')).toMatch(/TTY/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('`pair` drives the in-process link flow on a TTY (fails fast without the binary)', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const setPermissionResolver = vi.fn();
      // No signal-cli on the stubbed PATH -> channel.start throws the install
      // hint before any process could spawn. We assert `pair` wires the
      // session's resolver (the in-process flow) instead of delegating.
      await expect(
        signalDef.subcommands!.pair!.run(ctx({ startChannel, session: { setPermissionResolver } })),
      ).rejects.toThrow(/signal-cli not found/);
      expect(setPermissionResolver).toHaveBeenCalledTimes(1);
      expect(startChannel).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('`setup` starts the channel directly when headless', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const code = await signalDef.subcommands!.setup!.run(ctx({ startChannel }));
      expect(code).toBe(0);
      expect(startChannel).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('subcommands return 1 when vault is unavailable', async () => {
    const badCtx = {
      deps: { cwd: tmp, vault: undefined, logger: undefined, options: {} },
      args: { positional: [], flags: {} },
      startChannel: async () => 0,
      session: { setPermissionResolver: () => {} },
    } as never;
    const code = await signalDef.subcommands!.status!.run(badCtx);
    expect(code).toBe(1);
    expect(writeErr.join('')).toContain('vault unavailable');
  });
});
