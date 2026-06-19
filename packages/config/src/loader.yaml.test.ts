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
      `provider:
  name: anthropic
  model: claude-sonnet-4-6
mode: default
`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.provider?.name).toBe('anthropic');
    expect(result.config.provider?.model).toBe('claude-sonnet-4-6');
    expect(result.config.mode).toBe('default');
    expect(result.sources[0]?.scope).toBe('project');
  });

  it('loads .yml extension too', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yml'), `mode: research\n`);
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.mode).toBe('research');
  });

  it('walks upward to find a yaml config', async () => {
    const nested = path.join(tmp, 'a/b/c');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), `mode: default\n`);
    const result = await loadConfig({ cwd: nested, skipUser: true });
    expect(result.config.mode).toBe('default');
  });

  it('rejects a yaml config whose schema is invalid', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `provider:
  name: 42
`,
    );
    await expect(loadConfig({ cwd: tmp, skipUser: true })).rejects.toThrow(/Invalid moxxy config/);
  });

  it('accepts an empty yaml file', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), '');
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config).toEqual({});
  });

  it('handles complex nested config (plugins, channels, embeddings)', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `provider:
  name: anthropic
  model: claude-sonnet-4-6
embeddings:
  provider: openai
  model: text-embedding-3-small
plugins:
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
    expect(result.config.embeddings?.provider).toBe('openai');
    expect(result.config.plugins?.['@moxxy/plugin-browser']?.enabled).toBe(false);
    expect(result.config.channels?.['http']).toEqual({
      port: 8080,
      allowedTools: ['Read', 'Glob'],
    });
  });

  it('accepts a partial security block missing `enabled` (optional field)', async () => {
    // A hand-written or config_set-built `security:` block with only `isolator`
    // must validate; `enabled` defaults to false at the consumer.
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), `security:\n  isolator: inproc\n`);
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.security?.isolator).toBe('inproc');
    expect(result.config.security?.enabled).toBeUndefined();
  });

  it('accepts a partial embeddings block missing `provider` (optional field)', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `embeddings:\n  model: text-embedding-3-small\n`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.embeddings?.model).toBe('text-embedding-3-small');
    expect(result.config.embeddings?.provider).toBeUndefined();
  });

  it('YAML at project level is overridden by .ts at same level (loader precedence)', async () => {
    // Both exist; first match wins per CONFIG_NAMES order. YAML is listed first
    // so it should take precedence over .ts. This codifies the order.
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), `mode: default\n`);
    await fs.writeFile(path.join(tmp, 'moxxy.config.js'), `export default { mode: 'research' };`);
    const result = await loadConfig({ cwd: tmp, skipUser: true });
    expect(result.config.mode).toBe('default');
  });
});
