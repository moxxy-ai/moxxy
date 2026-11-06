/**
 * `opencode auth list` and `opencode models` start OpenCode 2's shared
 * background server when none runs, and that server keeps their environment.
 * A stand-in `opencode` (the external boundary) records what it was given.
 */
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { checkOpenCode } from './login.js';

const roots: string[] = [];
const saved = { token: process.env.MOXXY_BROWSER_BRIDGE_TOKEN, electron: process.env.ELECTRON_RUN_AS_NODE, home: process.env.MOXXY_HOME };
afterEach(() => {
  for (const root of roots.splice(0)) removeDirSync(root);
  const restore = (key: string, value: string | undefined) => (value === undefined ? delete process.env[key] : (process.env[key] = value));
  restore('MOXXY_BROWSER_BRIDGE_TOKEN', saved.token);
  restore('ELECTRON_RUN_AS_NODE', saved.electron);
  restore('MOXXY_HOME', saved.home);
});

describe.skipIf(process.platform === 'win32')("the OpenCode commands Moxxy runs to check it", () => {
  it("leave Moxxy's own variables out, since the server they may start keeps them", async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moxxy-opencode-env-'));
    roots.push(root);
    const seen = path.join(root, 'env.json');
    const fake = path.join(root, 'opencode');
    writeFileSync(fake, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify(process.env));\nconsole.log('0 credentials');\n`);
    chmodSync(fake, 0o755);
    process.env.MOXXY_BROWSER_BRIDGE_TOKEN = 'bridge-secret';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.env.MOXXY_HOME = '/tmp/moxxy-home';

    await checkOpenCode(fake);

    const env = JSON.parse(readFileSync(seen, 'utf8')) as Record<string, string>;
    expect(Object.keys(env).filter((key) => key.startsWith('MOXXY_') && key !== 'MOXXY_HOME')).toEqual([]);
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.MOXXY_HOME).toBe('/tmp/moxxy-home');
    expect(env.PATH).toBe(process.env.PATH);
  });
});
