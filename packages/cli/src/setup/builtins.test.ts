import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Session, silentLogger } from '@moxxy/core';
import { buildVaultPlugin, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { BUILTIN_REQUIREMENT_DECISIONS, buildBuiltinsCore } from './builtins.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-builtins-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('builtin plugin requirement inventory', () => {
  it('documents a requirement decision for every builtin plugin entry', () => {
    const session = new Session({ cwd: tmp, logger: silentLogger });
    const { plugin: vaultPlugin, vault } = buildVaultPlugin({
      filePath: path.join(tmp, 'vault.json'),
      keySource: createStaticKeySource(deriveKey('pw', generateSalt())),
    });
    const built = buildBuiltinsCore({
      session,
      rawConfig: {},
      vault,
      vaultPlugin,
      schedulerRunner: { runPrompt: async () => ({ text: '' }) },
      webhookRunner: { runPrompt: async () => ({ text: '' }) },
      logger: silentLogger,
    });

    const missing = built.entries
      .map((entry) => entry.name)
      .filter((name) => BUILTIN_REQUIREMENT_DECISIONS[name] === undefined);

    expect(missing).toEqual([]);
    // memory(+consolidate, merged into one plugin) is no longer a builtin
    // entry — the slim wave's last unbundle.
    // stt-whisper-codex is no longer a builtin entry (slim wave) — its
    // requirements gate now reads from the on-disk package.json at discovery.
  });
});
