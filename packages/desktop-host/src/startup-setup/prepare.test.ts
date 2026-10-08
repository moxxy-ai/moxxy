/**
 * The work a packaged launch does before its first runner, run for real on a
 * temp installer and profile. Only npm's registry is a stand-in (the network).
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PackageRegistry } from '../component-update.js';
import { fixtureProviderCode, providerFixture, removeProviderFixtures } from '../provider-update.fixture.js';
import { prepareInstalledApp, type PrepareInstalledAppOptions } from './prepare.js';
import { StartupSetup } from './setup.js';
import { readSetupStamp } from './stamp.js';

afterEach(removeProviderFixtures);

const unpublished: PackageRegistry = { latestVersion: async () => null, hasVersion: async () => false };
const published: PackageRegistry = { latestVersion: async () => null, hasVersion: async () => true };

/** An installer carrying one model connection, over a profile that has an older copy of it. */
type Launch = Partial<PrepareInstalledAppOptions> & { readonly bundledVersion?: string };

async function installed(overrides: Partial<PrepareInstalledAppOptions> = {}) {
  const fixture = await providerFixture();
  const seed = join(fixture.resourcesPath, 'plugins-seed');
  await writeFile(join(seed, 'package.json'), JSON.stringify({ name: 'seed', dependencies: { [fixture.plugin]: '0.39.0' } }));
  await writeFile(join(seed, 'seed-fingerprints.json'), JSON.stringify({ schemaVersion: 1, packages: { [fixture.plugin]: 'aaa' } }));
  const options = (setup: StartupSetup): PrepareInstalledAppOptions => ({
    resourcesPath: fixture.resourcesPath,
    moxxyHome: fixture.moxxyHome,
    userDataDir: join(fixture.moxxyHome, '..', 'user-data'),
    shellVersion: '0.6.0',
    componentsVersion: '0.39.0',
    cliVersion: () => '0.39.0',
    registry: unpublished,
    npm: () => null,
    providers: [fixture.plugin],
    setup,
    ...overrides,
  });
  const launch = async ({ bundledVersion, ...extra }: Launch = {}) => {
    if (bundledVersion) {
      await writeFile(join(fixture.source, 'package.json'), JSON.stringify({ name: fixture.plugin, version: bundledVersion, type: 'module' }));
    }
    const setup = new StartupSetup();
    await prepareInstalledApp({ ...options(setup), ...extra });
    return setup.snapshot();
  };
  return { fixture, launch };
}

describe('prepareInstalledApp', () => {
  it('sets up what a new installer carries without asking', async () => {
    const { fixture, launch } = await installed();

    const state = await launch();

    expect(state).toEqual({
      reason: 'update',
      phase: 'done',
      steps: [
        { id: 'extensions', status: 'done' },
        { id: 'connections', status: 'done' },
      ],
      notes: [],
    });
    expect(await readFile(join(fixture.target, 'dist/index.js'), 'utf8')).toContain('gpt-6-astra');
  });

  it('says once what it replaced when a connection was changed by hand', async () => {
    const { fixture, launch } = await installed();
    await launch();
    await writeFile(join(fixture.target, 'dist/index.js'), '// edited by hand');
    await writeFile(join(fixture.source, 'dist/index.js'), '// newer installer\n' + fixtureProviderCode);

    const state = await launch({ shellVersion: '0.7.0' });

    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]).toMatch(/ChatGPT sign-in was updated.*previous copy/);
    expect((await launch({ shellVersion: '0.7.0' })).notes).toEqual([]);
  });

  it('keeps one backup of a connection, however many installers replaced it', async () => {
    const { fixture, launch } = await installed();
    const backups = join(fixture.moxxyHome, 'desktop', 'provider-updates', fixture.plugin.slice('@moxxy/'.length));
    for (const shellVersion of ['0.6.0', '0.7.0', '0.8.0']) {
      await writeFile(join(fixture.source, 'dist/index.js'), `// installer ${shellVersion}\n${fixtureProviderCode}`);
      await launch({ shellVersion });
    }

    const [kept, ...others] = await readdir(backups);

    expect(others).toEqual([]);
    expect(await readFile(join(backups, kept as string, 'previous', 'dist/index.js'), 'utf8')).toContain('installer 0.7.0');
    expect(await readFile(join(fixture.target, 'dist/index.js'), 'utf8')).toContain('installer 0.8.0');
  });

  it('has nothing to set up on the launch after', async () => {
    const { launch } = await installed();
    await launch();

    expect(await launch()).toEqual({ reason: null, phase: 'done', steps: [], notes: [] });
  });

  it('tries a connection again on the next launch when it could not be installed', async () => {
    const { fixture, launch } = await installed();
    await writeFile(join(fixture.source, 'dist/index.js'), 'throw Error("bad package");');

    const state = await launch();

    expect(state.steps.at(-1)).toMatchObject({ id: 'connections', status: 'failed' });
    expect(await readFile(join(fixture.target, 'dist/index.js'), 'utf8')).toContain('old locally');
    expect((await launch()).steps.map((step) => step.id)).toEqual(['extensions', 'connections']);
  });

  it('brings the runner to the version the app was built with, once', async () => {
    const { fixture, launch } = await installed();
    await launch();
    const newer = { componentsVersion: '0.40.0' };

    const state = await launch(newer);

    expect(state).toMatchObject({ reason: 'update', steps: [{ id: 'components', status: 'done' }], notes: [] });
    expect((await readSetupStamp(fixture.moxxyHome)).components).toBe('0.40.0');
    expect((await launch(newer)).steps).toEqual([]);
  });

  it('keeps the runner as it is when it cannot be installed, says so, and does not hold the next launch', async () => {
    const { launch } = await installed();
    await launch();
    const newer = { componentsVersion: '0.40.0', registry: published };

    const state = await launch(newer);

    expect(state.steps).toEqual([{ id: 'components', status: 'failed', error: expect.stringContaining('npm') }]);
    expect((await launch(newer)).steps).toEqual([]);
  });

  it('does not ask npm for a connection the installer is about to put in place', async () => {
    const { fixture, launch } = await installed();
    // The profile's copy came from npm, as a registry install records it.
    await writeFile(join(fixture.moxxyHome, 'plugins', 'package.json'), JSON.stringify({ dependencies: { [fixture.plugin]: '0.39.0' } }));
    const asked: string[] = [];
    const registry: PackageRegistry = { latestVersion: async () => null, hasVersion: async (name) => (asked.push(name), false) };

    // The profile's copy (0.39.0) is behind the app (0.40.0) until the installer replaces it.
    const state = await launch({ componentsVersion: '0.40.0', cliVersion: () => '0.40.0', registry, bundledVersion: '0.40.0' });

    expect(state.steps.map((step) => `${step.id}:${step.status}`)).toEqual(['extensions:done', 'connections:done', 'components:done']);
    expect(asked).toEqual([]);
  });

  it('does nothing in a build that carries no extensions', async () => {
    const { launch } = await installed({ resourcesPath: join(process.cwd(), 'no-such-resources') });

    expect(await launch()).toEqual({ reason: null, phase: 'done', steps: [], notes: [] });
  });
});
