import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import type { ChannelDef } from '@moxxy/sdk';
import { buildSlackPlugin } from './index.js';
import {
  SLACK_AUTHORIZED_KEY,
  SLACK_BOT_TOKEN_KEY,
  SLACK_SIGNING_SECRET_KEY,
} from './keys.js';

let tmp: string;
let vault: VaultStore;
let slackDef: ChannelDef;
let writeOut: string[];
let writeErr: string[];
let origStdoutWrite: typeof process.stdout.write;
let origStderrWrite: typeof process.stderr.write;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-slack-sub-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  const plugin = buildSlackPlugin({ vault });
  slackDef = (plugin.channels ?? [])[0] as ChannelDef;
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
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  process.stdout.write = origStdoutWrite;
  process.stderr.write = origStderrWrite;
  delete process.env.MOXXY_SLACK_BOT_TOKEN;
  delete process.env.MOXXY_SLACK_SIGNING_SECRET;
});

function ctx(overrides: { startChannel?: () => Promise<number> } = {}) {
  return {
    deps: { cwd: tmp, vault, logger: undefined, options: {} },
    args: { positional: [], flags: {} },
    startChannel: overrides.startChannel ?? (async () => 0),
    session: { setPermissionResolver: () => {} },
  } as never;
}

describe('slack channel subcommands (registered on ChannelDef)', () => {
  it('exposes setup, pair, status, unpair', () => {
    expect(slackDef.subcommands).toBeDefined();
    expect(Object.keys(slackDef.subcommands ?? {})).toEqual(
      expect.arrayContaining(['setup', 'pair', 'status', 'unpair']),
    );
    expect(slackDef.interactiveCommand).toBe('setup');
  });

  it('`status` reports unconfigured vault state as JSON', async () => {
    const code = await slackDef.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed).toEqual({
      botTokenConfigured: false,
      signingSecretConfigured: false,
      authorized: null,
      tunnelUrl: null,
    });
  });

  it('`status` surfaces stored token + secret + authorization', async () => {
    await vault.set(SLACK_BOT_TOKEN_KEY, 'xoxb-1111-2222-abcdefghijklmnop');
    await vault.set(SLACK_SIGNING_SECRET_KEY, '0123456789abcdef0123456789abcdef');
    await vault.set(
      SLACK_AUTHORIZED_KEY,
      JSON.stringify({ teamId: 'T1', channelId: 'C1' }),
    );
    const code = await slackDef.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed).toEqual({
      botTokenConfigured: true,
      signingSecretConfigured: true,
      authorized: { teamId: 'T1', channelId: 'C1' },
      tunnelUrl: null,
    });
  });

  it('`status` honors env overrides for token/secret', async () => {
    process.env.MOXXY_SLACK_BOT_TOKEN = 'xoxb-env-token-abcdefghijkl';
    process.env.MOXXY_SLACK_SIGNING_SECRET = 'env-signing-secret-0123456789';
    const code = await slackDef.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed.botTokenConfigured).toBe(true);
    expect(parsed.signingSecretConfigured).toBe(true);
  });

  it('`status` reports null for a corrupt authorization record', async () => {
    await vault.set(SLACK_AUTHORIZED_KEY, 'not-json');
    const code = await slackDef.subcommands?.status?.run(ctx());
    expect(code).toBe(0);
    const parsed = JSON.parse(writeOut.join(''));
    expect(parsed.authorized).toBeNull();
  });

  it('`unpair` clears the authorization and reports', async () => {
    await vault.set(SLACK_AUTHORIZED_KEY, JSON.stringify({ teamId: 'T1' }));
    const code = await slackDef.subcommands?.unpair?.run(ctx());
    expect(code).toBe(0);
    expect(writeOut.join('')).toContain('unpaired');
    expect(await vault.get(SLACK_AUTHORIZED_KEY)).toBeNull();
  });

  it('`unpair` is a no-op when nothing is paired', async () => {
    const code = await slackDef.subcommands?.unpair?.run(ctx());
    expect(code).toBe(0);
    expect(writeOut.join('')).toContain('no pairing was active');
  });

  it('`pair` refuses to start without a TTY (interactive-only flow)', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const code = await slackDef.subcommands?.pair?.run(ctx({ startChannel }));
      expect(code).toBe(1);
      expect(startChannel).not.toHaveBeenCalled();
      expect(writeErr.join('')).toMatch(/TTY/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('`setup` starts the channel directly when not on a TTY', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const startChannel = vi.fn(async () => 0);
      const code = await slackDef.subcommands?.setup?.run(ctx({ startChannel }));
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
    const code = await slackDef.subcommands?.status?.run(badCtx);
    expect(code).toBe(1);
    expect(writeErr.join('')).toContain('vault unavailable');
  });

  it('isAvailable gates on BOTH token and secret', async () => {
    // Neither set → unavailable, reason names both.
    let avail = await slackDef.isAvailable?.({ cwd: tmp, vault });
    expect(avail?.ok).toBe(false);
    expect(avail?.reason).toMatch(/bot token/);
    expect(avail?.reason).toMatch(/signing secret/);

    // Only token → still unavailable, reason names the secret.
    await vault.set(SLACK_BOT_TOKEN_KEY, 'xoxb-1111-2222-abcdefghijklmnop');
    avail = await slackDef.isAvailable?.({ cwd: tmp, vault });
    expect(avail?.ok).toBe(false);
    expect(avail?.reason).toMatch(/signing secret/);

    // Both → available.
    await vault.set(SLACK_SIGNING_SECRET_KEY, '0123456789abcdef0123456789abcdef');
    avail = await slackDef.isAvailable?.({ cwd: tmp, vault });
    expect(avail?.ok).toBe(true);
  });
});
