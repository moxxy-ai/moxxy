/** What the Codex Moxxy starts for a conversation inherits; a stand-in `codex` (the external boundary) records it. */
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { spawnCodexAppServer } from './executable.js';

const roots: string[] = [];
const saved = { electron: process.env.ELECTRON_RUN_AS_NODE, nodePath: process.env.NODE_PATH, token: process.env.MOXXY_BROWSER_BRIDGE_TOKEN, home: process.env.MOXXY_HOME };
afterEach(() => {
  for (const root of roots.splice(0)) removeDirSync(root);
  const restore = (key: string, value: string | undefined) => (value === undefined ? delete process.env[key] : (process.env[key] = value));
  restore('ELECTRON_RUN_AS_NODE', saved.electron);
  restore('NODE_PATH', saved.nodePath);
  restore('MOXXY_BROWSER_BRIDGE_TOKEN', saved.token);
  restore('MOXXY_HOME', saved.home);
});

describe.skipIf(process.platform === 'win32')('the Codex Moxxy starts for a conversation', () => {
  it("does not inherit Moxxy's own variables but MOXXY_HOME, its ELECTRON_RUN_AS_NODE nor the app's folders on NODE_PATH", async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moxxy-codex-env-'));
    roots.push(root);
    const seen = path.join(root, 'env.json');
    const fake = path.join(root, 'codex');
    writeFileSync(fake, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify(process.env));\n`);
    chmodSync(fake, 0o755);
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.env.MOXXY_BROWSER_BRIDGE_TOKEN = 'bridge-secret';
    process.env.MOXXY_HOME = '/tmp/moxxy-home';
    process.env.NODE_PATH = '/Users/me/lib/node:/Applications/MoxxyAI Workspaces.app/Contents/Resources/app.asar/node_modules';

    const codex = await spawnCodexAppServer(fake)({ cwd: root });
    await new Promise<void>((resolve) => codex.readable.once('close', () => resolve()).resume());
    codex.close();

    expect(existsSync(seen)).toBe(true);
    const env = JSON.parse(readFileSync(seen, 'utf8')) as Record<string, string>;
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NODE_PATH).toBe('/Users/me/lib/node');
    expect(env.PATH).toBe(process.env.PATH);
    expect(Object.keys(env).filter((key) => key.startsWith('MOXXY_'))).toEqual(['MOXXY_HOME']);
  });
});
