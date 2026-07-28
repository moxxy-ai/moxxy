import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from './loader.js';

// These cases exercise the EXECUTABLE-config loading machinery itself (jiti,
// the ESM module-registry cache-buster, per-cwd resolution), so they stand in
// for a user who already approved the file. Consent is covered separately in
// the "executable-config consent" block below.
const approve = async (): Promise<boolean> => true;

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-config-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns empty config when no file is found', async () => {
    const result = await loadConfig({ cwd: tmp, skipUser: true, trustPrompt: approve });
    expect(result.config).toEqual({});
    expect(result.sources).toEqual([]);
  });

  it('loads a moxxy.config.js from cwd', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { plugins: { provider: { default: 'anthropic', items: { anthropic: { model: 'sonnet' } } } } };`,
    );
    const result = await loadConfig({ cwd: tmp, skipUser: true, trustPrompt: approve });
    expect(result.config.plugins?.provider?.default).toBe('anthropic');
    expect(result.config.plugins?.provider?.items?.anthropic?.model).toBe('sonnet');
    expect(result.sources[0]?.scope).toBe('project');
  });

  it('walks upward to find moxxy.config.js', async () => {
    const nested = path.join(tmp, 'a/b/c');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { plugins: { mode: { default: 'default' } } };`,
    );
    const result = await loadConfig({ cwd: nested, skipUser: true, trustPrompt: approve });
    expect(result.config.plugins?.mode?.default).toBe('default');
  });

  it('honors explicitPath over upward search', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { plugins: { mode: { default: 'default' } } };`,
    );
    const custom = path.join(tmp, 'custom.config.js');
    await fs.writeFile(custom, `export default { plugins: { mode: { default: 'research' } } };`);
    const result = await loadConfig({ cwd: tmp, explicitPath: custom, skipUser: true, trustPrompt: approve });
    expect(result.config.plugins?.mode?.default).toBe('research');
    expect(result.sources[0]?.scope).toBe('explicit');
  });

  it('rejects a config whose schema is invalid', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export default { plugins: { provider: { default: 42 } } };`,
    );
    await expect(loadConfig({ cwd: tmp, skipUser: true, trustPrompt: approve })).rejects.toThrow(/Invalid moxxy config/);
  });

  it('rejects a config with no default export', async () => {
    await fs.writeFile(
      path.join(tmp, 'moxxy.config.js'),
      `export const config = {};`,
    );
    await expect(loadConfig({ cwd: tmp, skipUser: true, trustPrompt: approve })).rejects.toThrow(/default-export/);
  });

  it('reloads a rewritten .mjs config freshly even on rapid successive loads', async () => {
    // The first import is plain (single module-registry entry, no per-load
    // cache-buster → no leak); subsequent reloads append a monotonic-counter
    // buster so back-to-back reloads in the same millisecond can't return the
    // stale cached module. Use .mjs so it goes through importJsConfig, not jiti.
    const file = path.join(tmp, 'moxxy.config.mjs');
    await fs.writeFile(file, `export default { plugins: { mode: { default: 'default' } } };`);
    const first = await loadConfig({ cwd: tmp, skipUser: true, trustPrompt: approve });
    expect(first.config.plugins?.mode?.default).toBe('default');

    await fs.writeFile(file, `export default { plugins: { mode: { default: 'goal' } } };`);
    // Two reloads with no delay between them (same-ms risk).
    const [a, b] = await Promise.all([
      loadConfig({ cwd: tmp, skipUser: true, trustPrompt: approve }),
      loadConfig({ cwd: tmp, skipUser: true, trustPrompt: approve }),
    ]);
    expect(a.config.plugins?.mode?.default).toBe('goal');
    expect(b.config.plugins?.mode?.default).toBe('goal');
  });

  it('resolves each .ts config\'s relative imports against ITS OWN dir (jiti cache keyed by cwd)', async () => {
    // Two projects in two dirs, each with a .ts config that imports a sibling
    // module. A jiti instance binds its resolution base to the dir it was
    // created with; a single shared instance would resolve the SECOND config's
    // `./marker` against the FIRST dir, picking up the wrong value.
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-jiti-a-'));
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-jiti-b-'));
    try {
      await fs.writeFile(path.join(dirA, 'marker.ts'), `export const marker = 'from-A';`);
      await fs.writeFile(
        path.join(dirA, 'moxxy.config.ts'),
        `import { marker } from './marker';\nexport default { plugins: { provider: { default: 'x', items: { x: { model: marker } } } } };`,
      );
      await fs.writeFile(path.join(dirB, 'marker.ts'), `export const marker = 'from-B';`);
      await fs.writeFile(
        path.join(dirB, 'moxxy.config.ts'),
        `import { marker } from './marker';\nexport default { plugins: { provider: { default: 'x', items: { x: { model: marker } } } } };`,
      );

      const a = await loadConfig({ cwd: dirA, skipUser: true, trustPrompt: approve });
      const b = await loadConfig({ cwd: dirB, skipUser: true, trustPrompt: approve });

      expect(a.config.plugins?.provider?.items?.x?.model).toBe('from-A');
      expect(b.config.plugins?.provider?.items?.x?.model).toBe('from-B');
    } finally {
      await fs.rm(dirA, { recursive: true, force: true });
      await fs.rm(dirB, { recursive: true, force: true });
    }
  });
});

describe('system scope, locked keys, and executable-config consent', () => {
  let home: string;
  let project: string;
  let sysDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-sys-home-'));
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-sys-proj-'));
    sysDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-sys-etc-'));
    for (const k of ['MOXXY_HOME', 'MOXXY_SYSTEM_CONFIG']) saved[k] = process.env[k];
    process.env.MOXXY_HOME = home;
    delete process.env.MOXXY_SYSTEM_CONFIG;
  });

  afterEach(async () => {
    for (const k of ['MOXXY_HOME', 'MOXXY_SYSTEM_CONFIG']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await Promise.all(
      [home, project, sysDir].map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  const writeSystem = async (yaml: string): Promise<string> => {
    const p = path.join(sysDir, 'config.yaml');
    await fs.writeFile(p, yaml);
    process.env.MOXXY_SYSTEM_CONFIG = p;
    return p;
  };

  it('loads the system scope and reports it as a source', async () => {
    await writeSystem('maxIterations: 7\n');
    const { config, sources } = await loadConfig({ cwd: project });
    expect(config.maxIterations).toBe(7);
    expect(sources.some((s) => s.scope === 'system')).toBe(true);
  });

  // The guarantee the whole scope exists for: a user cannot turn off what the
  // operator pinned.
  it('a locked key survives a user config trying to override it', async () => {
    await writeSystem('security:\n  enabled: true\nlocked:\n  - security.enabled\n');
    await fs.writeFile(path.join(home, 'config.yaml'), 'security:\n  enabled: false\n');

    const warnings: string[] = [];
    const { config, lockedOverrides } = await loadConfig({
      cwd: project,
      warn: (m) => warnings.push(m),
    });

    expect(config.security?.enabled).toBe(true);
    expect(lockedOverrides).toEqual([{ key: 'security.enabled', scope: 'user' }]);
    expect(warnings.join('\n')).toContain('security.enabled');
  });

  it('a locked key survives a project config too', async () => {
    await writeSystem('network:\n  proxy: http://corp:3128\nlocked:\n  - network.proxy\n');
    await fs.writeFile(path.join(project, 'moxxy.config.yaml'), 'network:\n  proxy: "off"\n');
    const { config } = await loadConfig({ cwd: project, warn: () => {} });
    expect(config.network?.proxy).toBe('http://corp:3128');
  });

  it('unlocked keys still merge normally from lower layers', async () => {
    await writeSystem('security:\n  enabled: true\nlocked:\n  - security.enabled\n');
    await fs.writeFile(path.join(home, 'config.yaml'), 'maxIterations: 42\n');
    const { config } = await loadConfig({ cwd: project });
    expect(config.maxIterations).toBe(42);
    expect(config.security?.enabled).toBe(true);
  });

  // The hole this closes: cd into a cloned repo and its config executes.
  it('refuses to execute an untrusted project config when nobody can be asked', async () => {
    await fs.writeFile(
      path.join(project, 'moxxy.config.ts'),
      'export default { maxIterations: 99 }\n',
    );
    const warnings: string[] = [];
    const { config, skipped } = await loadConfig({ cwd: project, warn: (m) => warnings.push(m) });

    expect(config.maxIterations).toBeUndefined();
    expect(skipped).toHaveLength(1);
    expect(warnings.join('\n')).toContain('moxxy config trust');
  });

  it('executes it once approved through the prompt, and remembers the approval', async () => {
    const cfgPath = path.join(project, 'moxxy.config.ts');
    await fs.writeFile(cfgPath, 'export default { maxIterations: 99 }\n');

    let asked = 0;
    const first = await loadConfig({
      cwd: project,
      trustPrompt: async () => {
        asked++;
        return true;
      },
    });
    expect(first.config.maxIterations).toBe(99);

    // Second load must not ask again.
    const second = await loadConfig({ cwd: project });
    expect(second.config.maxIterations).toBe(99);
    expect(asked).toBe(1);
  });

  it('a declined prompt skips the file rather than throwing', async () => {
    await fs.writeFile(path.join(project, 'moxxy.config.ts'), 'export default { maxIterations: 99 }\n');
    const { config, skipped } = await loadConfig({
      cwd: project,
      trustPrompt: async () => false,
      warn: () => {},
    });
    expect(config.maxIterations).toBeUndefined();
    expect(skipped[0]?.reason).toBe('not approved');
  });

  it('the system config can forbid executable configs outright', async () => {
    await writeSystem('config:\n  allowExecutable: false\n');
    await fs.writeFile(path.join(project, 'moxxy.config.ts'), 'export default { maxIterations: 99 }\n');
    const { config, skipped } = await loadConfig({
      cwd: project,
      // Even an approving prompt must not get a say once policy says no.
      trustPrompt: async () => true,
      warn: () => {},
    });
    expect(config.maxIterations).toBeUndefined();
    expect(skipped[0]?.reason).toContain('disabled by the system config');
  });

  // YAML is data, so it was never the risk and must not gain friction.
  it('never gates a YAML project config', async () => {
    await fs.writeFile(path.join(project, 'moxxy.config.yaml'), 'maxIterations: 12\n');
    const { config, skipped } = await loadConfig({ cwd: project });
    expect(config.maxIterations).toBe(12);
    expect(skipped).toEqual([]);
  });

  it('skipSystem ignores the machine-wide layer', async () => {
    await writeSystem('maxIterations: 7\n');
    const { config, sources } = await loadConfig({ cwd: project, skipSystem: true });
    expect(config.maxIterations).toBeUndefined();
    expect(sources.some((s) => s.scope === 'system')).toBe(false);
  });
});
