/**
 * The extensions an installer carries (model connections, Computer Use) are
 * installed without asking anyone: the previous copy is kept, and what a
 * person may want to know comes back as a result. Runs the REAL provider
 * updater on a temp profile.
 */

import { readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installBundledUpdates, type BundledPackageUpdate } from './bundled-updates.js';
import { offerBundledProviderUpdate, type ProviderUpdateOffer } from './provider-update-runtime.js';
import { fixtureProviderCode, providerFixture, removeProviderFixtures } from './provider-update.fixture.js';

afterEach(removeProviderFixtures);

type Fixture = Awaited<ReturnType<typeof providerFixture>>;

const providerUpdate = (fixture: Fixture): BundledPackageUpdate<ProviderUpdateOffer> => ({
  plugin: fixture.plugin,
  run: (confirm) => offerBundledProviderUpdate({ ...fixture, confirm }),
});
const installedCode = (fixture: Fixture) => readFile(join(fixture.target, 'dist/index.js'), 'utf8');

describe('installBundledUpdates', () => {
  it('replaces a copy nobody recorded without asking, keeping the previous one', async () => {
    const fixture = await providerFixture();

    const [result] = await installBundledUpdates([providerUpdate(fixture)]);

    expect(await installedCode(fixture)).toContain('gpt-6-astra');
    expect(result).toEqual({ plugin: fixture.plugin, outcome: 'updated' });
  });

  it('replaces a copy changed since the installer put it there, and says where the previous one is', async () => {
    const fixture = await providerFixture();
    await installBundledUpdates([providerUpdate(fixture)]);
    await writeFile(join(fixture.target, 'dist/index.js'), '// edited by hand');
    await writeFile(join(fixture.source, 'dist/index.js'), '// newer installer\n' + fixtureProviderCode);

    const [result] = await installBundledUpdates([providerUpdate(fixture)]);

    expect(await installedCode(fixture)).toContain('newer installer');
    expect(result).toMatchObject({ plugin: fixture.plugin, outcome: 'updated' });
    const backup = result?.replacedLocalCopy;
    expect(backup).toBeTruthy();
    expect(await readFile(join(backup as string, 'dist/index.js'), 'utf8')).toBe('// edited by hand');
  });

  it('has nothing to report when the installer replaces its own unchanged copy', async () => {
    const fixture = await providerFixture();
    await installBundledUpdates([providerUpdate(fixture)]);
    await writeFile(join(fixture.source, 'dist/index.js'), '// newer installer\n' + (await readFile(join(fixture.source, 'dist/index.js'), 'utf8')));

    const [result] = await installBundledUpdates([providerUpdate(fixture)]);

    expect(await installedCode(fixture)).toContain('newer installer');
    expect(result).toEqual({ plugin: fixture.plugin, outcome: 'updated' });
  });

  it('reports a copy that is already current as such', async () => {
    const fixture = await providerFixture();
    await installBundledUpdates([providerUpdate(fixture)]);

    expect(await installBundledUpdates([providerUpdate(fixture)])).toEqual([{ plugin: fixture.plugin, outcome: 'current' }]);
  });

  it('keeps the previous version when the bundled one does not load, and goes on to the next', async () => {
    const broken = await providerFixture();
    await writeFile(join(broken.source, 'dist/index.js'), 'throw Error("bad package");');
    const fine = await providerFixture();

    const results = await installBundledUpdates([providerUpdate(broken), providerUpdate(fine)]);

    expect(results[0]).toMatchObject({ plugin: broken.plugin, outcome: 'failed' });
    expect(results[0]?.error).toMatch(/previous version retained/);
    expect(await installedCode(broken)).toContain('old locally');
    expect(results[1]?.outcome).toBe('updated');
  });

  it('leaves an extension linked to local source alone', async () => {
    const fixture = await providerFixture();
    const source = join(fixture.moxxyHome, 'my-checkout');
    await rename(fixture.target, source);
    await symlink(source, fixture.target, 'junction');

    const results = await installBundledUpdates([providerUpdate(fixture)]);

    expect(results).toEqual([{ plugin: fixture.plugin, outcome: 'current' }]);
    expect(await readFile(join(source, 'dist/index.js'), 'utf8')).toContain('old locally');
  });
});
