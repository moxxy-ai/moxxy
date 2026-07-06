/**
 * setupNativeResolution composes process.env.NODE_PATH so a hot-updated
 * bundle's optional native dep (@napi-rs/keyring) still resolves from the
 * shell's ABI-matched node_modules. A regression (prepend vs append, or a
 * broken existsSync filter) would silently break keychain resolution and fall
 * back to passphrase prompts, so lock the NODE_PATH composition + the
 * empty-candidates no-op.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path, { delimiter } from 'node:path';
import os from 'node:os';

import { setupNativeResolution } from './native-resolution';
import { assertDefined } from '@moxxy/sdk';

let tmp: string;
let savedNodePath: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'native-res-'));
  savedNodePath = process.env.NODE_PATH;
});

afterEach(() => {
  if (savedNodePath === undefined) delete process.env.NODE_PATH;
  else process.env.NODE_PATH = savedNodePath;
});

describe('setupNativeResolution', () => {
  it('APPENDS the shell node_modules to NODE_PATH (never prepends/shadows)', () => {
    const nm = path.join(tmp, 'node_modules');
    mkdirSync(nm);
    delete process.env.NODE_PATH;

    setupNativeResolution(tmp);

    expect(process.env.NODE_PATH).toBe(nm);
  });

  it('preserves an existing NODE_PATH, appending after the delimiter', () => {
    const nm = path.join(tmp, 'node_modules');
    mkdirSync(nm);
    process.env.NODE_PATH = '/pre/existing';

    setupNativeResolution(tmp);

    expect(process.env.NODE_PATH).toBe(`/pre/existing${delimiter}${nm}`);
    // The pre-existing entry comes FIRST (append, not prepend).
    const nodePath = process.env.NODE_PATH;
    assertDefined(nodePath, 'NODE_PATH');
    expect(nodePath.indexOf('/pre/existing')).toBeLessThan(nodePath.indexOf(nm));
  });

  it('leaves NODE_PATH untouched when no candidate node_modules dir exists', () => {
    // tmp has no node_modules and no sibling app.asar.unpacked.
    process.env.NODE_PATH = '/already/here';

    setupNativeResolution(tmp);

    expect(process.env.NODE_PATH).toBe('/already/here');
  });

  it('also picks up the electron-builder app.asar.unpacked sibling', () => {
    // floorRoot/../app.asar.unpacked/node_modules
    const unpacked = path.join(tmp, '..', path.basename(tmp) + '-sib');
    // Build a layout where floorRoot's parent holds app.asar.unpacked.
    const floorRoot = path.join(tmp, 'app', 'v1');
    mkdirSync(floorRoot, { recursive: true });
    const sibNm = path.join(tmp, 'app', 'app.asar.unpacked', 'node_modules');
    mkdirSync(sibNm, { recursive: true });
    void unpacked;
    delete process.env.NODE_PATH;

    setupNativeResolution(floorRoot);

    expect(process.env.NODE_PATH).toContain(sibNm);
  });
});
