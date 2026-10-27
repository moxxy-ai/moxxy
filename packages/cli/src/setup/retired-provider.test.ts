import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { writeFakeCli } from '@moxxy/vitest-preset/fake-cli';
import { setupSessionWithConfig } from '../setup.js';

// npm is the external process boundary. Setup, config, discovery, registries
// and the vault run for real in a throwaway home, with no network access.
async function withOfflineHome(
  config: string,
  run: (setup: () => ReturnType<typeof setupSessionWithConfig>, npmMarker: string) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'moxxy-retired-offline-'));
  const previous = { home: process.env.MOXXY_HOME, path: process.env.PATH };
  const marker = path.join(home, 'npm-called');
  const configPath = path.join(home, 'config.yaml');
  process.env.MOXXY_HOME = home;
  process.env.PATH = home + path.delimiter + (process.env.PATH ?? '');
  try {
    // On Windows Moxxy runs npm's own script beside the npm.cmd shim, as a
    // global Node install lays it out.
    writeFakeCli(
      path.join(home, 'npm'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'offline'); process.stderr.write('offline'); process.exit(1);`,
      { windowsEntry: 'node_modules/npm/bin/npm-cli.js' },
    );
    await writeFile(configPath, config);
    await run(() => setupSessionWithConfig({
      cwd: home, configPath, skipUserConfig: true, skipKeyPrompt: true, tolerateNoProvider: true,
      skipInitHooks: true, disableSessionPersistence: true, disableKeytar: true,
    }), marker);
  } finally {
    if (previous.home === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = previous.home;
    if (previous.path === undefined) delete process.env.PATH;
    else process.env.PATH = previous.path;
    await removeDir(home);
  }
}

it.each([
  ['the default provider', 'plugins:\n  provider:\n    default: openai-codex\n'],
  ['only a fallback', 'plugins:\n  provider:\n    default: my-own-vendor\n    fallbacks: [openai-codex]\n'],
])('opens provider recovery for a retired profile, with ChatGPT sign-in as %s, even when the Codex connection cannot be installed offline', async (_where, config) => {
  await withOfflineHome(config, async (setup, npmMarker) => {
    const result = await setup();
    try {
      expect(result.session.providers.getActiveName()).toBeNull();
      expect(await readFile(npmMarker, 'utf8')).toBe('offline');
    } finally { await result.session.close(); }
  });
});

it('still reports a failed install of a Codex agent the person chose themselves', async () => {
  await withOfflineHome('plugins:\n  provider:\n    default: codex-agent\n    fallbacks: [openai-codex]\n', async (setup) => {
    await expect(setup()).rejects.toThrow(/npm install failed/);
  });
});
