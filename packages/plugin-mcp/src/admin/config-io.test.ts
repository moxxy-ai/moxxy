import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mcpConfigPath,
  mutateMcpConfig,
  readMcpConfig,
  removeServerFromConfig,
  setServerDisabled,
  writeMcpConfig,
} from './config-io.js';
import type { McpStoredConfig } from './types.js';

// config-io derives every path from moxxyPath(), which honors $MOXXY_HOME.
// Point it at a fresh tmp dir per test so we never touch the real ~/.moxxy.
describe('admin/config-io', () => {
  let home: string;
  const original = process.env.MOXXY_HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'moxxy-mcp-cfg-'));
    process.env.MOXXY_HOME = home;
  });

  afterEach(async () => {
    if (original === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = original;
    await rm(home, { recursive: true, force: true });
  });

  it('writeMcpConfig -> readMcpConfig is a faithful atomic round-trip', async () => {
    const cfg: McpStoredConfig = {
      servers: [
        { kind: 'stdio', name: 'fs', command: 'npx', args: ['-y', 'srv'] },
        {
          kind: 'http',
          name: 'remote',
          url: 'https://example.test/mcp',
          // Opaque extras must survive the round-trip via .passthrough().
          cachedTools: [{ name: 'ping', description: 'pong', inputSchema: { type: 'object' } }],
          disabled: true,
        } as never,
      ],
    };
    await writeMcpConfig(cfg);
    const back = await readMcpConfig();
    expect(back).toEqual(cfg);
  });

  it('writes a trailing newline and leaves no temp file behind', async () => {
    await writeMcpConfig({ servers: [{ kind: 'stdio', name: 'a', command: 'x' }] });
    const raw = await fs.readFile(mcpConfigPath(), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    const entries = await fs.readdir(home);
    expect(entries.filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('readMcpConfig returns an empty catalog when the file is absent', async () => {
    expect(await readMcpConfig()).toEqual({ servers: [] });
  });

  it('discards malformed JSON without throwing and leaves the bad file in place', async () => {
    await fs.writeFile(mcpConfigPath(), '{ this is not json', 'utf8');
    expect(await readMcpConfig()).toEqual({ servers: [] });
    // Bad file preserved for the user to inspect.
    expect(await fs.readFile(mcpConfigPath(), 'utf8')).toBe('{ this is not json');
  });

  it('discards a structurally-invalid (Zod-failing) config without throwing', async () => {
    // A whole row with no usable name is dropped (per-entry), and a top-level
    // shape error (servers not an array) falls back to empty rather than crash.
    await fs.writeFile(mcpConfigPath(), JSON.stringify({ servers: [{ name: '' }] }), 'utf8');
    expect(await readMcpConfig()).toEqual({ servers: [] });

    await fs.writeFile(mcpConfigPath(), JSON.stringify({ servers: 'nope' }), 'utf8');
    expect(await readMcpConfig()).toEqual({ servers: [] });
  });

  it('keeps valid servers when one entry is malformed (u85-6: no whole-catalog wipe)', async () => {
    // One good row + one nameless row. The bad row must drop ALONE — the
    // valid server has to survive boot/list/enable/remove, not vanish.
    await fs.writeFile(
      mcpConfigPath(),
      JSON.stringify({
        servers: [
          { kind: 'stdio', name: 'good', command: 'x' },
          { kind: 'stdio', name: '', command: 'y' },
        ],
      }),
      'utf8',
    );
    const back = await readMcpConfig();
    expect(back.servers.map((s) => s.name)).toEqual(['good']);
    expect(back.servers[0]).toMatchObject({ kind: 'stdio', name: 'good', command: 'x' });
  });

  describe('setServerDisabled', () => {
    it('toggles the disabled flag and returns the updated entry', async () => {
      await writeMcpConfig({ servers: [{ kind: 'stdio', name: 'a', command: 'x' }] });
      const disabled = await setServerDisabled('a', true);
      expect(disabled).toMatchObject({ name: 'a', disabled: true });
      expect((await readMcpConfig()).servers[0]).toMatchObject({ name: 'a', disabled: true });

      const enabled = await setServerDisabled('a', false);
      expect(enabled).toMatchObject({ name: 'a', disabled: false });
      expect((await readMcpConfig()).servers[0]).toMatchObject({ name: 'a', disabled: false });
    });

    it('leaves sibling entries and per-entry fields untouched', async () => {
      await writeMcpConfig({
        servers: [
          { kind: 'stdio', name: 'a', command: 'x', args: ['--keep'] } as never,
          { kind: 'http', name: 'b', url: 'https://b.test' },
        ],
      });
      await setServerDisabled('a', true);
      const cfg = await readMcpConfig();
      expect(cfg.servers[0]).toMatchObject({ name: 'a', command: 'x', args: ['--keep'], disabled: true });
      expect(cfg.servers[1]).toEqual({ kind: 'http', name: 'b', url: 'https://b.test' });
    });

    it('returns null for an unknown server', async () => {
      await writeMcpConfig({ servers: [{ kind: 'stdio', name: 'a', command: 'x' }] });
      expect(await setServerDisabled('ghost', true)).toBeNull();
    });

    it('does not rewrite the file when the server is unknown (no-op skip)', async () => {
      await writeMcpConfig({ servers: [{ kind: 'stdio', name: 'a', command: 'x' }] });
      const before = await fs.stat(mcpConfigPath());
      await new Promise((r) => setTimeout(r, 10));
      expect(await setServerDisabled('ghost', true)).toBeNull();
      const after = await fs.stat(mcpConfigPath());
      expect(after.mtimeMs).toBe(before.mtimeMs);
    });
  });

  describe('removeServerFromConfig', () => {
    it('drops a server by name and reports the change', async () => {
      await writeMcpConfig({
        servers: [
          { kind: 'stdio', name: 'a', command: 'x' },
          { kind: 'stdio', name: 'b', command: 'y' },
        ],
      });
      expect(await removeServerFromConfig('a')).toBe(true);
      expect((await readMcpConfig()).servers.map((s) => s.name)).toEqual(['b']);
    });

    it('returns false (and changes nothing) for an unknown name', async () => {
      await writeMcpConfig({ servers: [{ kind: 'stdio', name: 'a', command: 'x' }] });
      expect(await removeServerFromConfig('ghost')).toBe(false);
      expect((await readMcpConfig()).servers.map((s) => s.name)).toEqual(['a']);
    });
  });

  describe('mutateMcpConfig', () => {
    it('skips the write entirely when the mutator returns the same reference (no-op)', async () => {
      await writeMcpConfig({ servers: [{ kind: 'stdio', name: 'a', command: 'x' }] });
      const before = await fs.stat(mcpConfigPath());
      // Ensure mtime can differ if a write were to happen.
      await new Promise((r) => setTimeout(r, 10));
      const result = await mutateMcpConfig((cfg) => ({ next: cfg, result: 'noop' }));
      expect(result).toBe('noop');
      const after = await fs.stat(mcpConfigPath());
      expect(after.mtimeMs).toBe(before.mtimeMs);
    });

    it('serializes concurrent mutators so neither read+write interleaves', async () => {
      await writeMcpConfig({ servers: [] });
      // Fire two adds concurrently. The mutex must serialize the
      // read-modify-write so both land — a lost update would drop one.
      await Promise.all([
        mutateMcpConfig((cfg) => ({
          next: { servers: [...cfg.servers, { kind: 'stdio', name: 'a', command: 'x' }] },
          result: undefined,
        })),
        mutateMcpConfig((cfg) => ({
          next: { servers: [...cfg.servers, { kind: 'stdio', name: 'b', command: 'y' }] },
          result: undefined,
        })),
      ]);
      const names = (await readMcpConfig()).servers.map((s) => s.name).sort();
      expect(names).toEqual(['a', 'b']);
    });
  });
});
