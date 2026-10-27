import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { writeFakeCli } from '@moxxy/vitest-preset/fake-cli';
import { setupSessionWithConfig } from '../setup.js';

// npm is the external process boundary. Setup, config, discovery, registries
// and the vault run for real in a throwaway home, with no network access.
it('opens provider recovery for a retired profile even when the Codex connection cannot be installed offline', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'moxxy-retired-offline-'));
  const previous = { home: process.env.MOXXY_HOME, path: process.env.PATH };
  const marker = path.join(home, 'npm-called');
  const configPath = path.join(home, 'config.yaml');
  process.env.MOXXY_HOME = home;
  process.env.PATH = home + path.delimiter + (process.env.PATH ?? '');
  try {
    writeFakeCli(path.join(home, 'npm'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'offline'); process.stderr.write('offline'); process.exit(1);`);
    await writeFile(configPath, 'plugins:\n  provider:\n    default: openai-codex\n');
    const result = await setupSessionWithConfig({ cwd: home, configPath, skipUserConfig: true, skipKeyPrompt: true, tolerateNoProvider: true, skipInitHooks: true, disableSessionPersistence: true, disableKeytar: true });
    try {
      expect(result.session.providers.getActiveName()).toBeNull();
      expect(await readFile(marker, 'utf8')).toBe('offline');
    } finally { await result.session.close(); }
  } finally {
    if (previous.home === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = previous.home;
    if (previous.path === undefined) delete process.env.PATH;
    else process.env.PATH = previous.path;
    await removeDir(home);
  }
});
