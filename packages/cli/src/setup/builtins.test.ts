import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Session, silentLogger } from '@moxxy/core';
import { AGENT_CONDUCT, asTurnId, assertDefined } from '@moxxy/sdk';
import { buildVaultPlugin, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { BUILTIN_REQUIREMENT_DECISIONS, buildBuiltinsCore } from './builtins.js';
import { removeDir } from '@moxxy/vitest-preset/fs';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-builtins-'));
});

afterEach(async () => {
  await removeDir(tmp);
});

function buildEntries(session: Session) {
  const { plugin: vaultPlugin, vault } = buildVaultPlugin({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('pw', generateSalt())),
  });
  return buildBuiltinsCore({
    session,
    rawConfig: {},
    vault,
    vaultPlugin,
    schedulerRunner: { runPrompt: async () => ({ text: '' }) },
    webhookRunner: { runPrompt: async () => ({ text: '' }) },
    logger: silentLogger,
  });
}

describe('builtin plugin requirement inventory', () => {
  it('documents a requirement decision for every builtin plugin entry', () => {
    const session = new Session({ cwd: tmp, logger: silentLogger });
    const built = buildEntries(session);

    const missing = built.entries
      .map((entry) => entry.name)
      .filter((name) => BUILTIN_REQUIREMENT_DECISIONS[name] === undefined);

    expect(missing).toEqual([]);
    expect(built.entries.map((entry) => entry.name)).toContain('@moxxy/mode-plan');
    // memory(+consolidate, merged into one plugin) is no longer a builtin
    // entry — the slim wave's last unbundle.
    // stt-whisper-codex is no longer a builtin entry (slim wave) — its
    // requirements gate now reads from the on-disk package.json at discovery.
  });
});

describe('agent conduct', () => {
  it('reaches every provider request of a CLI-built session, so the desktop, the TUI and the channels share it', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger });
    const conduct = buildEntries(session).entries.find((entry) => entry.name === '@moxxy/agent-conduct');
    assertDefined(conduct, 'the agent conduct builtin');
    session.pluginHost.registerStatic(conduct.plugin);

    const req = await session.dispatcher.dispatchBeforeProviderCall(
      { model: 'm', messages: [] },
      { ...session.appContext(), turnId: asTurnId('t1'), iteration: 0 },
    );

    expect(req.system).toBe(AGENT_CONDUCT);
  });
});
