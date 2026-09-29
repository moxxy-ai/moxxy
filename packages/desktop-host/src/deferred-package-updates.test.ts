/**
 * Bundled package updates that need the user's approval must never hold up a
 * runner: the question waits until the window is up, then an approved update
 * installs and the runners restart onto it. Runs the REAL provider updater on
 * a temp profile; only the dialog and the runner restart are stand-ins.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeferredPackageUpdates, type ManagedPackageUpdate } from './deferred-package-updates.js';
import { offerBundledProviderUpdate, type ProviderUpdateOffer } from './provider-update-runtime.js';
import { providerFixture, removeProviderFixtures } from './provider-update.fixture.js';

afterEach(removeProviderFixtures);

type Fixture = Awaited<ReturnType<typeof providerFixture>>;

function providerUpdate(
  fixture: Fixture,
  ask: (offer: ProviderUpdateOffer) => Promise<boolean>,
): ManagedPackageUpdate<ProviderUpdateOffer> {
  return {
    plugin: fixture.plugin,
    run: (confirm) => offerBundledProviderUpdate({ ...fixture, confirm }),
    ask,
  };
}

const installedCode = (fixture: Fixture) => readFile(join(fixture.target, 'dist/index.js'), 'utf8');

function updates() {
  const restartRunners = vi.fn(async () => undefined);
  const warn = vi.fn(async (_plugin: string, _error: unknown) => undefined);
  return { deferred: new DeferredPackageUpdates({ restartRunners, warn }), restartRunners, warn };
}

describe('DeferredPackageUpdates', () => {
  it('lets the runner start while an update waits for the user, without changing the installed copy', async () => {
    const fixture = await providerFixture();
    const ask = vi.fn(() => new Promise<boolean>(() => undefined)); // nobody answers
    const { deferred } = updates();

    await deferred.prepare([providerUpdate(fixture, ask)]);

    expect(ask).not.toHaveBeenCalled();
    expect(await installedCode(fixture)).toContain('old locally');
  });

  it('asks once the window is up, installs the approved update and restarts the runners onto it', async () => {
    const fixture = await providerFixture();
    const ask = vi.fn(async (offer: ProviderUpdateOffer) => offer.localChanges === 'untracked');
    const { deferred, restartRunners } = updates();
    await deferred.prepare([providerUpdate(fixture, ask)]);

    await deferred.offer();

    expect(ask).toHaveBeenCalledOnce();
    expect(await installedCode(fixture)).toContain('gpt-6-astra');
    expect(restartRunners).toHaveBeenCalledOnce();
  });

  it('keeps the installed copy and the running runners when the user says later', async () => {
    const fixture = await providerFixture();
    const { deferred, restartRunners } = updates();
    await deferred.prepare([providerUpdate(fixture, async () => false)]);

    await deferred.offer();

    expect(await installedCode(fixture)).toContain('old locally');
    expect(restartRunners).not.toHaveBeenCalled();
  });

  it('installs an update that needs no approval before the runner starts, asking nobody', async () => {
    const fixture = await providerFixture();
    await offerBundledProviderUpdate({ ...fixture, confirm: async () => true });
    await writeFile(join(fixture.source, 'dist/index.js'), '// newer installer\n' + (await readFile(join(fixture.source, 'dist/index.js'), 'utf8')));
    const ask = vi.fn(async () => true);
    const { deferred, restartRunners } = updates();

    await deferred.prepare([providerUpdate(fixture, ask)]);
    await deferred.offer();

    expect(await installedCode(fixture)).toContain('newer installer');
    expect(ask).not.toHaveBeenCalled();
    expect(restartRunners).not.toHaveBeenCalled();
  });

  it('reports a failed update once the window is up instead of holding the runner', async () => {
    const fixture = await providerFixture();
    await writeFile(join(fixture.source, 'dist/index.js'), 'throw Error("bad package");');
    const { deferred, warn, restartRunners } = updates();
    await deferred.prepare([providerUpdate(fixture, async () => true)]);
    expect(warn).not.toHaveBeenCalled();

    await deferred.offer();

    expect(warn).toHaveBeenCalledWith(fixture.plugin, expect.any(Error));
    expect(await installedCode(fixture)).toContain('old locally');
    expect(restartRunners).not.toHaveBeenCalled();
  });
});
