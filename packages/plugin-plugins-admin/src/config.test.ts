import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  clearPluginState,
  loadDisabledPackageNames,
  setCategoryDefault,
  setPluginEnabled,
} from './config.js';

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

  it('setCategoryDefault writes plugins.<category>.default and rejects unknown categories', async () => {
    await setCategoryDefault('provider', 'openai', { configPath });
    await setCategoryDefault('mode', 'goal', { configPath });
    const parsed = parse(readFileSync(configPath, 'utf8')) as {
      plugins?: { provider?: { default?: string }; mode?: { default?: string } };
    };
    expect(parsed.plugins?.provider?.default).toBe('openai');
    expect(parsed.plugins?.mode?.default).toBe('goal');
    await expect(setCategoryDefault('bogus', 'x', { configPath })).rejects.toThrow(
      /unknown plugin category/,
    );
  });

  it('setCategoryDefault and setPluginEnabled coexist under one plugins tree', async () => {
    await setPluginEnabled('@moxxy/plugin-telegram', false, { configPath });
    await setCategoryDefault('compactor', 'summarize', { configPath });
    const parsed = parse(readFileSync(configPath, 'utf8')) as {
      plugins?: {
        packages?: Record<string, { enabled?: boolean }>;
        compactor?: { default?: string };
      };
    };
    expect(parsed.plugins?.packages?.['@moxxy/plugin-telegram']?.enabled).toBe(false);
    expect(parsed.plugins?.compactor?.default).toBe('summarize');
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

  it('treats a missing config file as no disabled plugins (ENOENT → empty set)', async () => {
    const missing = path.join(dir, 'does-not-exist.yaml');
    const disabled = await loadDisabledPackageNames({ configPath: missing });
    expect(disabled.size).toBe(0);
  });

  it('preserves unrelated existing config keys when toggling a plugin', async () => {
    writeFileSync(configPath, 'systemPrompt: hello\nmaxIterations: 7\n');
    await setPluginEnabled('@moxxy/plugin-a', false, { configPath });
    const parsed = parse(readFileSync(configPath, 'utf8')) as {
      systemPrompt?: string;
      maxIterations?: number;
      plugins?: { packages?: Record<string, { enabled?: boolean }> };
    };
    expect(parsed.systemPrompt).toBe('hello');
    expect(parsed.maxIterations).toBe(7);
    expect(parsed.plugins?.packages?.['@moxxy/plugin-a']?.enabled).toBe(false);
  });

  it('clearPluginState keeps a sibling plugin entry', async () => {
    await setPluginEnabled('@moxxy/plugin-a', false, { configPath });
    await setPluginEnabled('@moxxy/plugin-b', false, { configPath });
    await clearPluginState('@moxxy/plugin-a', { configPath });
    const disabled = await loadDisabledPackageNames({ configPath });
    expect(disabled).not.toContain('@moxxy/plugin-a');
    expect(disabled).toContain('@moxxy/plugin-b');
  });

  // A typo or unrelated invalid key elsewhere in the hand-edited config must
  // NOT strand the plugin gate: the read path degrades to "no disabled
  // plugins" and toggling still works (validating only the plugins subtree).
  it('does not throw on an unrelated invalid key; the plugins gate still loads', async () => {
    writeFileSync(
      configPath,
      'maxIterations: not-a-number\nplugins:\n  packages:\n    "@moxxy/plugin-a":\n      enabled: false\n',
    );
    const disabled = await loadDisabledPackageNames({ configPath });
    expect(disabled).toContain('@moxxy/plugin-a');
  });

  // Unparseable YAML degrades to empty rather than crashing the toggle path,
  // and the bad file is left in place (not overwritten on read).
  it('treats unparseable YAML as no disabled plugins (degrade to empty)', async () => {
    // Genuinely unparseable: an unterminated flow sequence (no closing `]`).
    const before = 'plugins: [1, 2\n';
    writeFileSync(configPath, before);
    const disabled = await loadDisabledPackageNames({ configPath });
    expect(disabled.size).toBe(0);
  });

  // Toggling must not destroy user comments or drop config keys this package
  // doesn't model (the YAML is edited in place, not round-tripped through zod).
  it('preserves comments and unmodelled keys when toggling', async () => {
    writeFileSync(
      configPath,
      '# keep me\nprovider:\n  name: anthropic # inline\nexperimentalFutureKey: 42\n',
    );
    await setPluginEnabled('@moxxy/plugin-a', false, { configPath });
    const raw = readFileSync(configPath, 'utf8');
    expect(raw).toContain('# keep me');
    expect(raw).toContain('# inline');
    expect(raw).toContain('experimentalFutureKey: 42');
    expect(await loadDisabledPackageNames({ configPath })).toContain('@moxxy/plugin-a');
  });

  // A single malformed plugin row must not hide the disabled flag of siblings.
  it('drops only a malformed plugin row, keeping valid siblings', async () => {
    writeFileSync(
      configPath,
      'plugins:\n  packages:\n    "@moxxy/good":\n      enabled: false\n    "@moxxy/bad":\n      enabled: not-a-bool\n',
    );
    const disabled = await loadDisabledPackageNames({ configPath });
    expect(disabled).toContain('@moxxy/good');
    expect(disabled).not.toContain('@moxxy/bad');
  });
});
