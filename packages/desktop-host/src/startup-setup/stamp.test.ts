import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { installerIdentity, readSetupStamp, setupNeeds, writeSetupStamp } from './stamp.js';

const root = mkdtempSync(path.join(tmpdir(), 'setup-stamp-'));
afterAll(() => removeDirSync(root));

/** An installed app's resources, carrying a plugins seed with these fingerprints. */
function resources(fingerprints: Record<string, string> | null): string {
  const dir = mkdtempSync(path.join(root, 'resources-'));
  if (fingerprints) {
    mkdirSync(path.join(dir, 'plugins-seed'));
    writeFileSync(path.join(dir, 'plugins-seed', 'seed-fingerprints.json'), JSON.stringify({ schemaVersion: 1, packages: fingerprints }));
  }
  return dir;
}
const home = () => mkdtempSync(path.join(root, 'home-'));

describe('installerIdentity', () => {
  it('is the same for the same installer and changes with what it carries', async () => {
    const a = await installerIdentity(resources({ '@moxxy/plugin-view': 'aaa' }), '0.6.0');
    expect(a).toBe(await installerIdentity(resources({ '@moxxy/plugin-view': 'aaa' }), '0.6.0'));
    expect(a).not.toBe(await installerIdentity(resources({ '@moxxy/plugin-view': 'bbb' }), '0.6.0'));
    expect(a).not.toBe(await installerIdentity(resources({ '@moxxy/plugin-view': 'aaa' }), '0.6.1'));
  });

  it('is null for a build that carries no extensions (a development run)', async () => {
    expect(await installerIdentity(resources(null), '0.6.0')).toBeNull();
  });
});

describe('setup stamp', () => {
  it('remembers what was set up, across launches', async () => {
    const dir = home();
    expect(await readSetupStamp(dir)).toEqual({ installer: null, components: null });
    await writeSetupStamp(dir, { installer: 'abc', components: '1.1.0' });
    expect(await readSetupStamp(dir)).toEqual({ installer: 'abc', components: '1.1.0' });
  });

  it('reads a damaged stamp as nothing set up', async () => {
    const dir = home();
    mkdirSync(path.join(dir, 'desktop'), { recursive: true });
    writeFileSync(path.join(dir, 'desktop', 'setup-stamp.json'), '{"installer":');
    expect(await readSetupStamp(dir)).toEqual({ installer: null, components: null });
  });
});

describe('setupNeeds', () => {
  const stamp = { installer: 'abc', components: '1.1.0' };
  const current = { identity: 'abc', stamp, componentsVersion: '1.1.0', componentsBehind: false, hasProfile: true };

  it('needs nothing on an ordinary launch', () => {
    expect(setupNeeds(current)).toEqual({ reason: null, steps: [] });
  });

  it('sets up everything the installer carries on a first launch', () => {
    expect(setupNeeds({ ...current, stamp: { installer: null, components: null }, hasProfile: false })).toEqual({
      reason: 'install',
      steps: ['extensions', 'connections'],
    });
  });

  it('sets up again after a new installer', () => {
    expect(setupNeeds({ ...current, identity: 'def' })).toEqual({ reason: 'update', steps: ['extensions', 'connections'] });
  });

  it('treats a profile from before stamps existed as updated, not new', () => {
    expect(setupNeeds({ ...current, stamp: { installer: null, components: null } }).reason).toBe('update');
  });

  it('brings the runner and extensions up after an app update that expects newer ones', () => {
    expect(setupNeeds({ ...current, componentsVersion: '1.2.0', componentsBehind: true })).toEqual({
      reason: 'update',
      steps: ['components'],
    });
  });

  it('does not try the same version again once it was settled', () => {
    expect(setupNeeds({ ...current, componentsBehind: true })).toEqual({ reason: null, steps: [] });
  });

  it('puts everything the installer carries in place before asking npm for the rest', () => {
    // What the installer brings is no longer behind by then, so npm is asked
    // only for what it did not carry — not for a copy about to be replaced.
    expect(setupNeeds({ ...current, identity: 'def', componentsVersion: '1.2.0', componentsBehind: true }).steps).toEqual([
      'extensions',
      'connections',
      'components',
    ]);
  });

  it('needs nothing from a build that carries no extensions', () => {
    expect(setupNeeds({ ...current, identity: null, componentsVersion: '1.2.0', componentsBehind: true })).toEqual({ reason: null, steps: [] });
  });
});
