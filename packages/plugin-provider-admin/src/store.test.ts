import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  readProvidersConfig,
  removeStoredProvider,
  upsertStoredProvider,
} from './store.js';
import type { StoredProvider } from './types.js';

const sampleEntry: StoredProvider = {
  kind: 'openai-compat',
  name: 'zai',
  baseURL: 'https://api.z.ai/api/coding/paas/v4',
  defaultModel: 'glm-4.6',
  models: [{ id: 'glm-4.6', contextWindow: 200_000, supportsTools: true, supportsStreaming: true }],
};

let tmpDir: string;
let cfgPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-provider-admin-'));
  // Stored vendors now live in the unified user config (plugins.provider.items).
  cfgPath = path.join(tmpDir, 'config.yaml');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('stored-provider tree store (plugins.provider.items)', () => {
  it('returns an empty list when the file is missing', async () => {
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it('round-trips a single provider through upsert/read', async () => {
    await upsertStoredProvider(sampleEntry, cfgPath);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]).toMatchObject({
      name: 'zai',
      defaultModel: 'glm-4.6',
      kind: 'openai-compat',
      baseURL: sampleEntry.baseURL,
    });
    // The persisted YAML shape is the unified tree, not a side-store.
    const text = await fs.readFile(cfgPath, 'utf8');
    expect(text).toContain('provider:');
    expect(text).toContain('zai:');
    expect(text).toContain('kind: openai-compat');
  });

  it('upsert replaces an entry with the same name (no duplicates)', async () => {
    await upsertStoredProvider(sampleEntry, cfgPath);
    const updated: StoredProvider = { ...sampleEntry, defaultModel: 'glm-4.5-air' };
    const next = await upsertStoredProvider(updated, cfgPath);
    expect(next.providers).toHaveLength(1);
    expect(next.providers[0]!.defaultModel).toBe('glm-4.5-air');
  });

  it('upsert appends distinct entries', async () => {
    await upsertStoredProvider(sampleEntry, cfgPath);
    const second: StoredProvider = { ...sampleEntry, name: 'deepseek', baseURL: 'https://api.deepseek.com' };
    const next = await upsertStoredProvider(second, cfgPath);
    expect(next.providers).toHaveLength(2);
    expect(next.providers.map((p) => p.name).sort()).toEqual(['deepseek', 'zai']);
  });

  it('remove returns false when the entry was not present', async () => {
    expect(await removeStoredProvider('nonexistent', cfgPath)).toBe(false);
  });

  it('remove drops the entry and returns true', async () => {
    await upsertStoredProvider(sampleEntry, cfgPath);
    expect(await removeStoredProvider('zai', cfgPath)).toBe(true);
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it("remove refuses to touch a built-in provider's item (model/enabled prefs)", async () => {
    // `plugins.provider.items.anthropic.model` written by the /model picker is
    // NOT a stored vendor; provider_remove must never delete those prefs.
    await fs.writeFile(
      cfgPath,
      'plugins:\n  provider:\n    items:\n      anthropic:\n        model: claude-opus-4-8\n',
    );
    expect(await removeStoredProvider('anthropic', cfgPath)).toBe(false);
    const text = await fs.readFile(cfgPath, 'utf8');
    expect(text).toContain('claude-opus-4-8');
  });

  it('coexists with picker-written model/enabled prefs on OTHER items', async () => {
    await fs.writeFile(
      cfgPath,
      'plugins:\n  provider:\n    default: anthropic\n    items:\n      anthropic:\n        model: claude-opus-4-8\n',
    );
    await upsertStoredProvider(sampleEntry, cfgPath);
    const cfg = await readProvidersConfig(cfgPath);
    // Only the vendor entry surfaces as a stored provider…
    expect(cfg.providers.map((p) => p.name)).toEqual(['zai']);
    // …and the built-in's prefs survive untouched.
    const text = await fs.readFile(cfgPath, 'utf8');
    expect(text).toContain('claude-opus-4-8');
    expect(text).toContain('default: anthropic');
  });

  it('treats a malformed YAML file as empty on read', async () => {
    await fs.writeFile(cfgPath, '{{{ not yaml', 'utf8');
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers).toEqual([]);
  });

  it('defaults supportsTools/supportsStreaming on a legacy hand-edited model', async () => {
    await fs.writeFile(
      cfgPath,
      [
        'plugins:',
        '  provider:',
        '    items:',
        '      legacy:',
        '        model: m',
        '        config:',
        '          kind: openai-compat',
        '          baseURL: https://api.legacy.com/v1',
        '          models:',
        '            - id: m',
        '              contextWindow: 1000',
        '',
      ].join('\n'),
    );
    const cfg = await readProvidersConfig(cfgPath);
    expect(cfg.providers[0]!.models[0]).toMatchObject({
      id: 'm',
      contextWindow: 1000,
      supportsTools: true,
      supportsStreaming: true,
    });
  });
});
