import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from '@moxxy/vitest-preset/fs';

export const fixturePlugin = '@moxxy/plugin-provider-openai-codex' as const;
export const fixtureProviderCode = `export default {name:'${fixturePlugin}', providers:[{name:'openai-codex',models:[{id:'gpt-6-astra'}],createClient(){throw Error('Must not authenticate during import')}}]};`;

const roots: string[] = [];

export async function removeProviderFixtures(): Promise<void> {
  for (const root of roots.splice(0)) await removeDir(root);
}

/** A packaged installer's bundled provider next to an older, locally installed copy. */
export async function providerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'provider-update-')); roots.push(root);
  const resourcesPath = join(root, 'resources'), moxxyHome = join(root, 'home');
  const plugin = fixturePlugin;
  const source = join(resourcesPath, 'plugins-seed/node_modules', plugin);
  const target = join(moxxyHome, 'plugins/node_modules', plugin);
  for (const directory of [source, target]) {
    await mkdir(join(directory, 'dist'), { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: plugin, version: '0.39.0', type: 'module' }));
  }
  await writeFile(join(source, 'dist/index.js'), fixtureProviderCode);
  await writeFile(join(target, 'dist/index.js'), '// old locally installed provider');
  return { resourcesPath, moxxyHome, plugin, source, target };
}
