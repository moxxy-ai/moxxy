import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Session, silentLogger } from '@moxxy/core';
import {
  buildVaultPlugin,
  createStaticKeySource,
  deriveKey,
  generateSalt,
} from '@moxxy/plugin-vault';

// Partial-mock ONLY the npm-touching pieces: the install closure must never
// shell out in tests, but the catalog/persist helpers the rest of builtins
// pulls in stay real.
vi.mock('@moxxy/plugin-plugins-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moxxy/plugin-plugins-admin')>();
  return {
    ...actual,
    installPluginPackagePinned: vi.fn(async () => ({
      installed: '@moxxy/mode-goal@1.2.3',
      dir: '/tmp/plugins',
    })),
    setPluginEnabled: vi.fn(async () => undefined),
  };
});

import { installPluginPackagePinned, setPluginEnabled } from '@moxxy/plugin-plugins-admin';
import { buildBuiltinsCore } from './builtins.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-padmin-view-'));
  vi.mocked(installPluginPackagePinned).mockClear();
  vi.mocked(setPluginEnabled).mockClear();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function buildFixture() {
  const session = new Session({ cwd: tmp, logger: silentLogger });
  const { plugin: vaultPlugin, vault } = buildVaultPlugin({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('pw', generateSalt())),
  });
  buildBuiltinsCore({
    session,
    rawConfig: {},
    vault,
    vaultPlugin,
    schedulerRunner: { runPrompt: async () => ({ text: '' }) },
    webhookRunner: { runPrompt: async () => ({ text: '' }) },
    logger: silentLogger,
  });
  return session;
}

describe('session.pluginsAdmin.install', () => {
  it('installs (pinned), persists the enable, hot-reloads, and reports the diff', async () => {
    const session = buildFixture();
    const reload = vi.spyOn(session.pluginHost, 'reload').mockImplementation((async () => {
      // Simulate the reload registering the new mode so the diff picks it up.
      session.modes.register({
        name: 'goal',
        description: 'test',
        run: async () => undefined,
      } as never);
      return undefined as never;
    }) as never);

    const admin = session.pluginsAdmin;
    expect(admin?.install).toBeDefined();
    // 'mode-goal' is not a catalog id today, so it resolves as a bare package
    // name; the closure passes it through to the pinned installer.
    const res = await admin!.install!('@moxxy/mode-goal');

    expect(installPluginPackagePinned).toHaveBeenCalledWith(
      expect.objectContaining({ packageName: '@moxxy/mode-goal' }),
    );
    expect(setPluginEnabled).toHaveBeenCalledWith('@moxxy/mode-goal', true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(res.installed).toBe('@moxxy/mode-goal@1.2.3');
    expect(res.registered['modes']).toEqual(['goal']);
  });

  it('skips the enable write for a git/path spec with no derivable package name', async () => {
    const session = buildFixture();
    vi.spyOn(session.pluginHost, 'reload').mockResolvedValue(undefined as never);
    await session.pluginsAdmin!.install!('github:someone/some-plugin');
    expect(setPluginEnabled).not.toHaveBeenCalled();
  });
});
