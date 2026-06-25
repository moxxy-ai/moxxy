import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { applyInitConfig, setPluginEnabled } from './user-config.js';
import { moxxyConfigSchema } from './schema.js';

let tmp: string;
let configPath: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-user-config-'));
  configPath = path.join(tmp, 'config.yaml');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function readParsed(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(configPath, 'utf8');
  return parseYaml(raw) as Record<string, unknown>;
}

describe('applyInitConfig', () => {
  it('writes the unified plugins tree the clean-slate schema reads', async () => {
    const written = await applyInitConfig(
      { provider: 'anthropic', model: 'claude-sonnet-4-6', mode: 'goal', embedder: 'openai' },
      { configPath },
    );
    expect(written).toBe(configPath);

    const parsed = await readParsed();
    expect(parsed).toMatchObject({
      plugins: {
        provider: { default: 'anthropic', items: { anthropic: { model: 'claude-sonnet-4-6' } } },
        mode: { default: 'goal' },
        embedder: { default: 'openai' },
      },
    });
    // The result must validate against the real config schema.
    expect(moxxyConfigSchema.safeParse(parsed).success).toBe(true);
  });

  it('MERGES into the existing package ledger instead of clobbering it', async () => {
    // Simulate ensureProvider/installPlugins enabling packages BEFORE the wizard
    // persists the provider default + model (the exact init ordering).
    await setPluginEnabled('@moxxy/plugin-provider-anthropic', true, { configPath });
    await setPluginEnabled('@moxxy/plugin-telegram', true, { configPath });

    await applyInitConfig(
      { provider: 'anthropic', model: 'claude-sonnet-4-6', mode: 'default', embedder: 'tfidf' },
      { configPath },
    );

    const parsed = (await readParsed()) as {
      plugins: {
        packages: Record<string, { enabled: boolean }>;
        provider: { default: string };
      };
    };
    // Ledger survived the merge.
    expect(parsed.plugins.packages['@moxxy/plugin-provider-anthropic']).toEqual({ enabled: true });
    expect(parsed.plugins.packages['@moxxy/plugin-telegram']).toEqual({ enabled: true });
    // And the provider default landed alongside it.
    expect(parsed.plugins.provider.default).toBe('anthropic');
  });

  it('omits the tfidf floor, a null model, and the security block by default', async () => {
    await applyInitConfig(
      { provider: 'anthropic', model: null, mode: 'default', embedder: 'tfidf' },
      { configPath },
    );
    const parsed = (await readParsed()) as { plugins: Record<string, unknown>; security?: unknown };
    expect(parsed.plugins.embedder).toBeUndefined();
    expect(parsed.plugins.provider).toEqual({ default: 'anthropic' });
    expect(parsed.security).toBeUndefined();
  });

  it('writes security.enabled only when opted in', async () => {
    await applyInitConfig(
      { provider: 'anthropic', mode: 'default', embedder: 'tfidf', security: { enabled: true } },
      { configPath },
    );
    const parsed = (await readParsed()) as { security: { enabled: boolean } };
    expect(parsed.security.enabled).toBe(true);
  });

  it('records fallbacks (excluding the primary) and never references the vault key', async () => {
    await applyInitConfig(
      { provider: 'anthropic', mode: 'default', embedder: 'tfidf', fallbacks: ['anthropic', 'openai'] },
      { configPath },
    );
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseYaml(raw) as { plugins: { provider: { fallbacks: string[] } } };
    expect(parsed.plugins.provider.fallbacks).toEqual(['openai']);
    // Like `moxxy provision`, the key lives in the vault under its canonical
    // name — the config must not carry a ${vault:...} apiKey ref.
    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('${vault:');
  });

  it('preserves user comments across the merge (comment-preserving round-trip)', async () => {
    await fs.writeFile(configPath, '# my hand-written config\nplugins:\n  packages: {}\n');
    await applyInitConfig(
      { provider: 'anthropic', mode: 'default', embedder: 'tfidf' },
      { configPath },
    );
    const raw = await fs.readFile(configPath, 'utf8');
    expect(raw).toContain('# my hand-written config');
  });
});
