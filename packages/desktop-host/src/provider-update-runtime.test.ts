import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { offerBundledProviderUpdate } from './provider-update-runtime.js';
import {
  fixturePlugin as plugin,
  fixtureProviderCode as code,
  providerFixture as fixture,
  removeProviderFixtures,
} from './provider-update.fixture.js';
import { removeDir } from '@moxxy/vitest-preset/fs';

const roots: string[] = [];
afterEach(async () => {
  await removeProviderFixtures();
  for (const root of roots.splice(0)) await removeDir(root);
});

it('requires confirmation for an untracked provider, then updates verified unchanged copies automatically', async () => {
  const options = await fixture();
  const offers: string[] = [];
  expect(await offerBundledProviderUpdate({ ...options, confirm: async offer => { offers.push(offer.localChanges); return false; } })).toBe('declined');
  expect(await readFile(join(options.target, 'dist/index.js'), 'utf8')).toContain('old locally');
  expect(await offerBundledProviderUpdate({ ...options, confirm: async offer => { offers.push(offer.localChanges); return true; } })).toBe('updated');
  const neverConfirm = async () => { throw Error('Verified unchanged installations need no prompt'); };
  expect(await offerBundledProviderUpdate({ ...options, confirm: neverConfirm })).toBe('current');
  await writeFile(join(options.source, 'dist/index.js'), code + '\n// new installer with the same package version');
  expect(await offerBundledProviderUpdate({ ...options, confirm: neverConfirm })).toBe('updated');
  expect(offers).toEqual(['untracked', 'untracked']);
  await writeFile(join(options.target, 'dist/index.js'), '// manual user changes');
  expect(await offerBundledProviderUpdate({ ...options, confirm: async offer => { expect(offer.localChanges).toBe('changed'); return false; } })).toBe('declined');
  expect(await readFile(join(options.target, 'dist/index.js'), 'utf8')).toContain('manual user changes');
});

it('restores the old provider when isolated import fails, without attempting login', async () => {
  const options = await fixture();
  await writeFile(join(options.source, 'dist/index.js'), 'throw Error("bad package");');
  await expect(offerBundledProviderUpdate({ ...options, confirm: async () => true })).rejects.toThrow(/verification/);
  expect(await readFile(join(options.target, 'dist/index.js'), 'utf8')).toContain('old locally');
});

it('keeps a newer installed provider instead of offering the older bundled one', async () => {
  const options = await fixture();
  await offerBundledProviderUpdate({ ...options, confirm: async () => true });
  await writeFile(join(options.source, 'package.json'), JSON.stringify({ name: plugin, version: '0.38.0', type: 'module' }));
  const neverAsk = async () => { throw Error('An older bundled copy is never offered'); };
  expect(await offerBundledProviderUpdate({ ...options, confirm: neverAsk })).toBe('current');
  expect(await readFile(join(options.target, 'dist/index.js'), 'utf8')).toContain('gpt-6-astra');
});

const bundledResources = process.env.MOXXY_TEST_PROVIDER_RESOURCES;
it.skipIf(!bundledResources)('updates both actual installer providers in an isolated existing profile without npm or credentials', async () => {
  if (!bundledResources) throw new Error('Installer resources are required');
  const root = await mkdtemp(join(tmpdir(), 'provider-installer-smoke-')); roots.push(root);
  for (const name of ['@moxxy/plugin-provider-openai', '@moxxy/plugin-provider-openai-codex'] as const) {
    const target = join(root, 'plugins/node_modules', name);
    await mkdir(join(target, 'dist'), { recursive: true });
    await writeFile(join(target, 'package.json'), JSON.stringify({ name, version: '0.1.0', type: 'module' }));
    await writeFile(join(target, 'dist/index.js'), '// legacy installer fixture');
    expect(await offerBundledProviderUpdate({ resourcesPath: bundledResources, moxxyHome: root, plugin: name,
      confirm: async offer => { expect(offer.localChanges).toBe('untracked'); return true; },
    })).toBe('updated');
    expect(await readFile(join(target, 'dist/index.js'), 'utf8')).not.toContain('legacy installer fixture');
  }
}, 180000);
