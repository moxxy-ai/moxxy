/**
 * Every update of an app-managed package leaves a transaction holding a full
 * copy of the one it replaced. Only the newest is worth keeping: the record of
 * the installed copy and one backup stay, the rest goes. Runs the REAL updater
 * on a temp profile.
 */

import { mkdir, readFile, readdir, rename, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installBundledUpdates } from './bundled-updates.js';
import { discardComputerUpdate, prepareComputerUpdate, pruneComputerUpdates, recordManagedInstall } from './computer-update.js';
import { offerBundledProviderUpdate } from './provider-update-runtime.js';
import { fixtureProviderCode, providerFixture, removeProviderFixtures } from './provider-update.fixture.js';

afterEach(removeProviderFixtures);

type Fixture = Awaited<ReturnType<typeof providerFixture>>;

const historyDir = (fixture: Fixture): string =>
  join(fixture.moxxyHome, 'desktop', 'provider-updates', fixture.plugin.slice('@moxxy/'.length));
const history = async (fixture: Fixture): Promise<string[]> => (await readdir(historyDir(fixture))).sort();
const prune = (fixture: Fixture): Promise<string[]> => pruneComputerUpdates(fixture.moxxyHome, fixture.plugin);

/** A new installer replaces the installed copy; `mark` is what its code says. */
async function update(fixture: Fixture, mark: string) {
  await writeFile(join(fixture.source, 'dist/index.js'), `// ${mark}\n${fixtureProviderCode}`);
  const [result] = await installBundledUpdates([
    { plugin: fixture.plugin, run: (confirm) => offerBundledProviderUpdate({ ...fixture, confirm }) },
  ]);
  return result;
}

/** Transactions are named at random; their journals' times say which is newer. */
async function age(fixture: Fixture, name: string, minutesAgo: number): Promise<void> {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(join(historyDir(fixture), name, 'transaction.json'), at, at);
}

describe('pruneComputerUpdates', () => {
  it('keeps the installed copy’s record with its backup and removes the older transactions', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    await update(fixture, 'second');
    await update(fixture, 'third');
    expect(await history(fixture)).toHaveLength(3);

    const removed = await prune(fixture);

    expect(removed).toHaveLength(2);
    const [kept] = await history(fixture);
    expect(await history(fixture)).toHaveLength(1);
    expect(await readFile(join(historyDir(fixture), kept as string, 'previous', 'dist/index.js'), 'utf8')).toContain('// second');
    expect(await readFile(join(fixture.target, 'dist/index.js'), 'utf8')).toContain('// third');
  });

  it('leaves the installed copy known as the installer’s own', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    await update(fixture, 'second');
    await prune(fixture);

    // Unchanged since the installer put it there: current now, and nothing to report when replaced.
    expect(await offerBundledProviderUpdate({ ...fixture, confirm: async () => true })).toBe('current');
    expect(await update(fixture, 'third')).toEqual({ plugin: fixture.plugin, outcome: 'updated' });
  });

  it('removes what an interrupted update left staged', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    const abandoned = join(historyDir(fixture), 'update-AbCd12');
    await mkdir(join(abandoned, 'staged'), { recursive: true });
    await writeFile(join(abandoned, 'staged', 'package.json'), '{}');

    expect(await prune(fixture)).toEqual([abandoned]);
    expect(await history(fixture)).toHaveLength(1);
  });

  it('leaves alone an update that is being staged right now', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    await writeFile(join(fixture.source, 'dist/index.js'), `// second\n${fixtureProviderCode}`);
    const inFlight = await prepareComputerUpdate(fixture);

    expect(await prune(fixture)).toEqual([]);
    expect(await readFile(join(inFlight.stagedPath, 'dist/index.js'), 'utf8')).toContain('// second');

    await discardComputerUpdate(inFlight);
  });

  it('touches nothing while an update is unfinished', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    await update(fixture, 'second');
    const [older] = await history(fixture);
    const journal = join(historyDir(fixture), older as string, 'transaction.json');
    await writeFile(journal, JSON.stringify({ ...JSON.parse(await readFile(journal, 'utf8')), phase: 'activated' }));

    expect(await prune(fixture)).toEqual([]);
    expect(await history(fixture)).toHaveLength(2);
  });

  it('touches nothing when the installed copy was changed by hand', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    await update(fixture, 'second');
    await writeFile(join(fixture.target, 'dist/index.js'), '// edited by hand');

    expect(await prune(fixture)).toEqual([]);
    expect(await history(fixture)).toHaveLength(2);
  });

  it('keeps the newest backup when the installed copy came without one', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    await update(fixture, 'second');
    const backups = await history(fixture);
    const holds = async (name: string): Promise<string> =>
      readFile(join(historyDir(fixture), name, 'previous', 'dist/index.js'), 'utf8');
    const newest = (await holds(backups[0] as string)).includes('// first') ? backups[0] : backups[1];
    const oldest = backups.find((name) => name !== newest);
    await age(fixture, newest as string, 10);
    await age(fixture, oldest as string, 20);
    // The desktop's own update from npm replaces the copy and records it: no backup of its own.
    await writeFile(join(fixture.target, 'dist/index.js'), `// from npm\n${fixtureProviderCode}`);

    await recordManagedInstall(fixture.moxxyHome, fixture.plugin);

    const left = await history(fixture);
    expect(left).toHaveLength(2);
    expect(left).toContain(newest);
    expect(left).not.toContain(oldest);
  });

  it('does not pile up records of the desktop’s own updates', async () => {
    const fixture = await providerFixture();
    for (const mark of ['one', 'two', 'three']) {
      await writeFile(join(fixture.target, 'dist/index.js'), `// ${mark}`);
      await recordManagedInstall(fixture.moxxyHome, fixture.plugin);
    }

    expect(await history(fixture)).toHaveLength(1);
  });

  it('leaves a copy linked to someone’s own source alone', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    await update(fixture, 'second');
    const own = join(fixture.moxxyHome, 'own-source');
    await rename(fixture.target, own);
    await symlink(own, fixture.target, 'junction');

    expect(await prune(fixture)).toEqual([]);
    expect(await history(fixture)).toHaveLength(2);
  });

  it('removes only update transactions', async () => {
    const fixture = await providerFixture();
    await update(fixture, 'first');
    await update(fixture, 'second');
    await mkdir(join(historyDir(fixture), 'notes'));
    await writeFile(join(historyDir(fixture), 'readme.txt'), 'mine');

    await prune(fixture);

    expect(await history(fixture)).toEqual(expect.arrayContaining(['notes', 'readme.txt']));
    expect(await history(fixture)).toHaveLength(3);
  });

  it('has nothing to do in a profile that was never updated', async () => {
    const fixture = await providerFixture();

    expect(await prune(fixture)).toEqual([]);
  });
});
