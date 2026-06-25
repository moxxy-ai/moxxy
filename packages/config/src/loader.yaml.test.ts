import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from './loader.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-yaml-cfg-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('YAML config loading', () => {
  it('loads a moxxy.config.yaml from cwd', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `plugins:
  provider:
    default: anthropic
    items:
      anthropic:
        model: claude-sonnet-4-6
  mode:
    default: default
`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.plugins?.provider?.default).toBe('anthropic');
    expect(result.config.plugins?.provider?.items?.anthropic?.model).toBe('claude-sonnet-4-6');
    expect(result.config.plugins?.mode?.default).toBe('default');
    expect(result.sources[0]?.scope).toBe('project');
  });

  it('loads .yml extension too', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yml'), `plugins:\n  mode:\n    default: research\n`);
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.plugins?.mode?.default).toBe('research');
  });

  it('walks upward to find a yaml config', async () => {
    const nested = path.join(tmp, 'a/b/c');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), `plugins:\n  mode:\n    default: default\n`);
    const result = await loadConfig({ cwd: nested, skipUser: true });
    expect(result.config.plugins?.mode?.default).toBe('default');
  });

  it('rejects a yaml config whose schema is invalid', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `plugins:
  provider:
    default: 42
`,
    );
    await expect(loadConfig({ cwd: tmp, skipUser: true })).rejects.toThrow(/Invalid moxxy config/);
  });

  it('rejects an unknown key inside the closed plugins tree', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), `plugins:\n  provdier:\n    default: anthropic\n`);
    await expect(loadConfig({ cwd: tmp, skipUser: true })).rejects.toThrow(/Invalid moxxy config/);
  });

  it('accepts an empty yaml file', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), '');
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config).toEqual({});
  });

  it('handles complex nested config (packages, channels, embedder)', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `plugins:
  provider:
    default: anthropic
    items:
      anthropic:
        model: claude-sonnet-4-6
  embedder:
    default: openai
    items:
      openai:
        model: text-embedding-3-small
  packages:
    '@moxxy/plugin-browser':
      enabled: false
channels:
  http:
    port: 8080
    allowedTools:
      - Read
      - Glob
`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.plugins?.embedder?.default).toBe('openai');
    expect(result.config.plugins?.packages?.['@moxxy/plugin-browser']?.enabled).toBe(false);
    expect(result.config.channels?.['http']).toEqual({
      port: 8080,
      allowedTools: ['Read', 'Glob'],
    });
  });

  it('accepts a partial security block missing `enabled` (optional field)', async () => {
    // A hand-written or config_set-built `security:` block with only `strict`
    // must validate; `enabled` defaults to false at the consumer.
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), `security:\n  strict: true\n`);
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.security?.strict).toBe(true);
    expect(result.config.security?.enabled).toBeUndefined();
  });

  it('preserves security.strict instead of silently stripping it', async () => {
    // Regression: `strict` is consumed by @moxxy/plugin-security
    // (SecurityPluginConfig.strict). If it were absent from securityConfigSchema,
    // zod would strip the unknown key on load and a user who set
    // `security.strict: true` would silently lose the hardening.
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `security:\n  enabled: true\n  strict: true\n`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.security?.strict).toBe(true);
  });

  it('accepts an embedder slot with item options', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `plugins:\n  embedder:\n    items:\n      openai:\n        model: text-embedding-3-small\n`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.plugins?.embedder?.items?.openai?.model).toBe('text-embedding-3-small');
    expect(result.config.plugins?.embedder?.default).toBeUndefined();
  });

  it('YAML at project level is overridden by .ts at same level (loader precedence)', async () => {
    // Both exist; first match wins per CONFIG_NAMES order. YAML is listed first
    // so it should take precedence over .ts. This codifies the order.
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), `plugins:\n  mode:\n    default: default\n`);
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { plugins: { mode: { default: 'research' } } };`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.plugins?.mode?.default).toBe('default');
  });
});
