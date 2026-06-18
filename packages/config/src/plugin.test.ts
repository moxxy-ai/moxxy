import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asSessionId, asToolCallId, asTurnId, type ToolContext } from '@moxxy/sdk';
import { buildConfigPlugin, type ConfigApplier, type ConfigApplyResult } from './plugin.js';

let tmp: string;

const ctx: ToolContext = {
  sessionId: asSessionId('s'),
  turnId: asTurnId('t'),
  callId: asToolCallId('c'),
  cwd: '/tmp',
  signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-cfg-plug-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function tool(name: string) {
  const plugin = buildConfigPlugin({ cwd: tmp });
  const t = plugin.tools?.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

describe('buildConfigPlugin tools', () => {
  it('config_path returns null when no project file exists', async () => {
    const out = (await tool('config_path').handler({ scope: 'project' }, ctx)) as {
      scope: string;
      path: string | null;
    };
    expect(out.scope).toBe('project');
    expect(out.path).toBeNull();
  });

  it('config_path finds an existing moxxy.config.yaml in cwd', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), 'mode: default\n');
    const out = (await tool('config_path').handler({ scope: 'project' }, ctx)) as {
      path: string;
    };
    expect(out.path).toContain('moxxy.config.yaml');
  });

  it('config_path walks upward to a project config in an ancestor dir', async () => {
    // Shared upward-walk (loader.findUpward): a config in `tmp` must be found
    // from a nested subdir, and ONLY the YAML names are matched (the editor
    // can't safely mutate a .ts config, so it must not resolve one).
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), 'mode: default\n');
    const nested = path.join(tmp, 'a', 'b', 'c');
    await fs.mkdir(nested, { recursive: true });
    const plugin = buildConfigPlugin({ cwd: nested });
    const t = plugin.tools?.find((x) => x.name === 'config_path');
    if (!t) throw new Error('config_path not found');
    const out = (await t.handler({ scope: 'project' }, ctx)) as { path: string | null };
    expect(out.path).toBe(path.join(tmp, 'moxxy.config.yaml'));
  });

  it('config_path does NOT resolve a .ts project config (editor only handles YAML)', async () => {
    // loadConfig honors moxxy.config.ts, but the editor walk deliberately omits
    // it — config_set can only YAML-edit, so resolving a .ts here would let it
    // create a competing .yaml. The divergent name list is by design.
    await fs.writeFile(path.join(tmp, 'moxxy.config.ts'), 'export default {}\n');
    const out = (await tool('config_path').handler({ scope: 'project' }, ctx)) as {
      path: string | null;
    };
    expect(out.path).toBeNull();
  });

  it('config_show returns the raw text', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), 'mode: default\n');
    const out = (await tool('config_show').handler({ scope: 'project' }, ctx)) as {
      text: string;
    };
    expect(out.text).toContain('mode: default');
  });

  it('config_get reads a value at a dot-path', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `provider:\n  model: sonnet\n  config:\n    apiKey: k\n`,
    );
    expect(await tool('config_get').handler({ scope: 'project', path: 'provider.model' }, ctx)).toBe('sonnet');
    expect(await tool('config_get').handler({ scope: 'project', path: 'provider.config.apiKey' }, ctx)).toBe('k');
  });

  it('config_get preserves legitimate falsy values (false / 0 / "") and only nulls a missing key', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `context:\n  caching: false\nmaxIterations: 0\nlabel: ""\n`,
    );
    // false / 0 / "" must round-trip as themselves; `cursor ?? null` used to
    // collapse all three to null so the model couldn't tell "set to false"
    // from "absent" when inspecting config.
    expect(await tool('config_get').handler({ scope: 'project', path: 'context.caching' }, ctx)).toBe(false);
    expect(await tool('config_get').handler({ scope: 'project', path: 'maxIterations' }, ctx)).toBe(0);
    expect(await tool('config_get').handler({ scope: 'project', path: 'label' }, ctx)).toBe('');
    // A genuinely absent key still returns null.
    expect(await tool('config_get').handler({ scope: 'project', path: 'context.missing' }, ctx)).toBeNull();
  });

  it('config_set writes a value, preserving the rest of the file', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      `mode: default\nprovider:\n  name: anthropic\n  model: haiku\n`,
    );
    await tool('config_set').handler(
      { scope: 'project', path: 'provider.model', value: '"sonnet"' },
      ctx,
    );
    const text = await fs.readFile(path.join(tmp, 'moxxy.config.yaml'), 'utf8');
    expect(text).toContain('mode: default');
    expect(text).toContain('name: anthropic');
    expect(text).toContain('model: sonnet');
  });

  it('config_set parses JSON values', async () => {
    await tool('config_set').handler(
      { scope: 'project', path: 'channels.http.allowedTools', value: '["Read","Glob"]' },
      ctx,
    );
    const text = await fs.readFile(path.join(tmp, 'moxxy.config.yaml'), 'utf8');
    expect(text).toMatch(/- Read/);
    expect(text).toMatch(/- Glob/);
  });

  it('config_set rejects writes that would violate the schema', async () => {
    await expect(
      tool('config_set').handler({ scope: 'project', path: 'provider.name', value: '42' }, ctx),
    ).rejects.toThrow(/invalid config/);
  });

  it('config_init creates a starter yaml when missing', async () => {
    const out = (await tool('config_init').handler({ scope: 'project' }, ctx)) as {
      created: boolean;
      path: string;
    };
    expect(out.created).toBe(true);
    const text = await fs.readFile(out.path, 'utf8');
    expect(text).toContain('provider:');
    expect(text).toContain('mode: default');
  });

  it('config_init is a no-op when a file already exists', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), 'mode: default\n');
    const out = (await tool('config_init').handler({ scope: 'project' }, ctx)) as {
      created: boolean;
    };
    expect(out.created).toBe(false);
  });

  // invariant 5: two concurrent config_set calls on the same plugin instance
  // each apply only their own edit on top of the same stale doc; without the
  // per-instance mutex the last atomic rename clobbers the other edit.
  it('serializes concurrent config_set on one instance (no lost update)', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.yaml'),
      'mode: default\nprovider:\n  name: anthropic\n  model: haiku\n',
    );
    const plugin = buildConfigPlugin({ cwd: tmp });
    const setTool = plugin.tools?.find((x) => x.name === 'config_set');
    if (!setTool) throw new Error('config_set not found');
    await Promise.all([
      setTool.handler({ scope: 'project', path: 'provider.model', value: '"sonnet"' }, ctx),
      setTool.handler({ scope: 'project', path: 'mode', value: '"goal"' }, ctx),
    ]);
    const text = await fs.readFile(path.join(tmp, 'moxxy.config.yaml'), 'utf8');
    const yamlMod = await import('yaml');
    const parsed = yamlMod.parse(text) as { mode?: string; provider?: { model?: string } };
    expect(parsed.mode).toBe('goal');
    expect(parsed.provider?.model).toBe('sonnet');
  });
});

describe('buildConfigPlugin runtime applier', () => {
  // Isolate MOXXY_HOME so loadConfig (config_reload/config_validate) never
  // merges the developer's real ~/.moxxy/config.yaml — keeps these tests
  // deterministic regardless of the host machine's user config.
  let prevHome: string | undefined;
  beforeEach(async () => {
    prevHome = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = path.join(tmp, 'home');
    await fs.mkdir(process.env.MOXXY_HOME, { recursive: true });
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = prevHome;
  });

  function pluginWith(applier?: ConfigApplier) {
    return buildConfigPlugin({ cwd: tmp, applier });
  }
  function toolOf(plugin: ReturnType<typeof buildConfigPlugin>, name: string) {
    const t = plugin.tools?.find((x) => x.name === name);
    if (!t) throw new Error(`tool not found: ${name}`);
    return t;
  }

  it('config_set surfaces the applier runtime result and passes the validated snapshot', async () => {
    const seen: unknown[] = [];
    const applier: ConfigApplier = async (snapshot) => {
      seen.push(snapshot);
      return { applied: ['mode'], pending: ['provider.name'] };
    };
    const out = (await toolOf(pluginWith(applier), 'config_set').handler(
      { scope: 'project', path: 'mode', value: '"goal"' },
      ctx,
    )) as { runtime: ConfigApplyResult };
    expect(out.runtime).toEqual({ applied: ['mode'], pending: ['provider.name'] });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { mode?: string }).mode).toBe('goal');
  });

  it('config_set catches an applier throw and reports it as a reload-failed pending entry', async () => {
    const applier: ConfigApplier = async () => {
      throw new Error('boom');
    };
    const out = (await toolOf(pluginWith(applier), 'config_set').handler(
      { scope: 'project', path: 'mode', value: '"goal"' },
      ctx,
    )) as { runtime: ConfigApplyResult };
    expect(out.runtime.applied).toEqual([]);
    expect(out.runtime.pending).toEqual(['reload-failed: boom']);
    // The write still landed even though the live-apply failed.
    const text = await fs.readFile(path.join(tmp, 'moxxy.config.yaml'), 'utf8');
    expect(text).toContain('mode: goal');
  });

  it('config_set returns an empty runtime result when no applier is wired', async () => {
    const out = (await toolOf(pluginWith(), 'config_set').handler(
      { scope: 'project', path: 'mode', value: '"goal"' },
      ctx,
    )) as { runtime: ConfigApplyResult };
    expect(out.runtime).toEqual({ applied: [], pending: [] });
  });

  it('config_reload returns the no-applier sentinel when applier omitted', async () => {
    const out = (await toolOf(pluginWith(), 'config_reload').handler({}, ctx)) as ConfigApplyResult;
    expect(out.applied).toEqual([]);
    expect(out.pending).toEqual(['(no runtime applier configured)']);
  });

  it('config_reload loads fresh config from disk and forwards it to the applier', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), 'mode: goal\n');
    let received: { mode?: string } | undefined;
    const applier: ConfigApplier = async (snapshot) => {
      received = snapshot;
      return { applied: ['mode'], pending: [] };
    };
    const out = (await toolOf(pluginWith(applier), 'config_reload').handler({}, ctx)) as ConfigApplyResult;
    expect(received?.mode).toBe('goal');
    expect(out).toEqual({ applied: ['mode'], pending: [] });
  });

  it('config_validate reports ok for a valid on-disk config', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), 'mode: default\n');
    const out = (await toolOf(pluginWith(), 'config_validate').handler({}, ctx)) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(true);
  });

  it('config_validate reports {ok:false,error} for an invalid on-disk config', async () => {
    await fs.writeFile(path.join(tmp, 'moxxy.config.yaml'), 'provider:\n  name: 42\n');
    const out = (await toolOf(pluginWith(), 'config_validate').handler({}, ctx)) as {
      ok: boolean;
      error?: string;
    };
    expect(out.ok).toBe(false);
    expect(typeof out.error).toBe('string');
  });
});
