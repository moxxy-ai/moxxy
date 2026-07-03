import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listPluginSetups, readPluginSetup, setupFieldVaultKey } from './setup-spec.js';

let tmp: string;
let prevHome: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-spec-'));
  prevHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = tmp;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prevHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function installFake(name: string, moxxy: unknown) {
  const dir = path.join(tmp, 'plugins', 'node_modules', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', moxxy }));
}

describe('readPluginSetup / listPluginSetups', () => {
  it('reads a declared setup, ignores packages without one, survives bad JSON', async () => {
    await installFake('@moxxy/plugin-channel-http', {
      plugin: { entry: './dist/index.js' },
      setup: { title: 'HTTP token', fields: [{ key: 'authToken', label: 'Token', kind: 'secret' }] },
    });
    await installFake('@moxxy/plugin-plain', { plugin: { entry: './dist/index.js' } });
    await fs.mkdir(path.join(tmp, 'plugins', 'node_modules', 'broken'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'plugins', 'node_modules', 'broken', 'package.json'), '{nope');

    expect((await readPluginSetup('@moxxy/plugin-channel-http'))?.title).toBe('HTTP token');
    expect(await readPluginSetup('@moxxy/plugin-plain')).toBeNull();
    expect(await readPluginSetup('@moxxy/not-installed')).toBeNull();

    const all = await listPluginSetups();
    expect(all.map((e) => e.packageName)).toEqual(['@moxxy/plugin-channel-http']);
  });
});

describe('setupFieldVaultKey', () => {
  it('explicit vaultKey wins; default derives <PKG>_<KEY> upper-snake', () => {
    expect(
      setupFieldVaultKey('@moxxy/plugin-channel-http', {
        key: 'authToken', label: 'x', kind: 'secret', vaultKey: 'MOXXY_HTTP_TOKEN',
      }),
    ).toBe('MOXXY_HTTP_TOKEN');
    expect(
      setupFieldVaultKey('@moxxy/plugin-channel-http', { key: 'authToken', label: 'x', kind: 'secret' }),
    ).toBe('PLUGIN_CHANNEL_HTTP_AUTH_TOKEN');
  });
});
