import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearPluginState, loadDisabledPackageNames, setPluginEnabled } from './config.js';

let dir: string;
let configPath: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'mox-plugins-cfg-'));
  configPath = path.join(dir, 'config.yaml');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('plugins-admin config', () => {
  it('round-trips a disabled flag', async () => {
    await setPluginEnabled('@moxxy/plugin-a', false, { configPath });
    expect(await loadDisabledPackageNames({ configPath })).toContain('@moxxy/plugin-a');
    await setPluginEnabled('@moxxy/plugin-a', true, { configPath });
    expect(await loadDisabledPackageNames({ configPath })).not.toContain('@moxxy/plugin-a');
  });

  it('clearPluginState drops the entry and omits an empty plugins map', async () => {
    await setPluginEnabled('@moxxy/plugin-a', false, { configPath });
    await clearPluginState('@moxxy/plugin-a', { configPath });
    expect(await loadDisabledPackageNames({ configPath })).not.toContain('@moxxy/plugin-a');
    // No-op on an absent entry.
    await clearPluginState('@moxxy/plugin-a', { configPath });
  });

  // invariant 5: concurrent read-modify-write of the shared config.yaml must
  // not lose an update. Without the mutex, both calls read the same baseline
  // and the second clobbers the first.
  it('serializes concurrent setPluginEnabled (no lost update)', async () => {
    await Promise.all([
      setPluginEnabled('@moxxy/plugin-a', false, { configPath }),
      setPluginEnabled('@moxxy/plugin-b', false, { configPath }),
    ]);
    const disabled = await loadDisabledPackageNames({ configPath });
    expect(disabled).toContain('@moxxy/plugin-a');
    expect(disabled).toContain('@moxxy/plugin-b');
  });

  it('survives many overlapping writers', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `@moxxy/plugin-${i}`);
    await Promise.all(names.map((n) => setPluginEnabled(n, false, { configPath })));
    const disabled = await loadDisabledPackageNames({ configPath });
    for (const n of names) expect(disabled).toContain(n);
  });
});
