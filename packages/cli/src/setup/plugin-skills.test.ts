import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupSession } from '../setup.js';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

/** A plugin installed under ~/.moxxy/plugins that ships a skill, the way Computer Use does. */
function installPlugin(home: string): void {
  const dir = path.join(home, 'plugins', 'node_modules', '@acme', 'plugin-desk');
  mkdirSync(path.join(dir, 'skills'), { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@acme/plugin-desk', version: '1.0.0', type: 'module', moxxy: { plugin: { entry: './index.js', skills: './skills' } } }),
  );
  writeFileSync(path.join(dir, 'index.js'), "export default { __moxxy: 'plugin', name: '@acme/plugin-desk', version: '1.0.0' };\n");
  writeFileSync(
    path.join(dir, 'skills', 'desk-control.md'),
    '---\nname: desk-control\ndescription: Operate the desk\nlabel: Desk\naliases: [desk_use]\n---\nUse the desk.\n',
  );
}

describe('setupSession with a plugin that ships skills', () => {
  const saved = process.env.MOXXY_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'moxxy-home-'));
    process.env.MOXXY_HOME = home;
    installPlugin(home);
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = saved;
    removeDirSync(home);
  });

  it('loads the skill, so the chat @ menu and an @ mention find it', async () => {
    const cwd = path.join(home, 'project');
    mkdirSync(cwd, { recursive: true });
    const session = await setupSession({ cwd, skipUserConfig: true, disableKeytar: true, skipKeyPrompt: true, tolerateNoProvider: true });
    try {
      expect(session.skills.byName('desk-control')).toMatchObject({ scope: 'plugin', frontmatter: { label: 'Desk' } });
      expect(session.getInfo().skills).toContainEqual(expect.objectContaining({ name: 'desk-control', label: 'Desk', aliases: ['desk_use'] }));
    } finally {
      await session.close();
    }
  }, 60_000);
});
