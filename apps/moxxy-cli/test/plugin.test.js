import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Set MOXXY_HOME to a temp dir before importing plugin-registry
const testHome = join(tmpdir(), `moxxy-plugin-test-${Date.now()}`);
process.env.MOXXY_HOME = testHome;

const {
  pluginPaths,
  readRegistry,
  writeRegistry,
  ensurePluginsDir,
  readPluginMeta,
  validatePluginMeta,
  isProcessAlive,
  sanitizeLogFileName,
  buildPluginEnv,
  BUILTIN_PLUGINS,
} = await import('../src/lib/plugin-registry.js');

describe('plugin-registry', () => {
  beforeEach(() => {
    mkdirSync(testHome, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('pluginPaths returns correct paths under MOXXY_HOME', () => {
    const paths = pluginPaths();
    assert.ok(paths.pluginsDir.includes('plugins'));
    assert.ok(paths.registryFile.includes('registry.json'));
    assert.ok(paths.logsDir.includes('logs'));
    assert.ok(paths.packageJsonFile.includes('package.json'));
  });

  it('readRegistry returns default when file missing', () => {
    const registry = readRegistry();
    assert.equal(registry.version, 1);
    assert.deepEqual(registry.plugins, {});
  });

  it('writeRegistry + readRegistry roundtrip', () => {
    ensurePluginsDir();
    const data = {
      version: 1,
      plugins: {
        'test-plugin': {
          name: 'test-plugin',
          version: '1.0.0',
          status: 'installed',
          enabled: false,
          builtin: false,
          pid: null,
          port: 8080,
          installedAt: '2026-03-29T10:00:00Z',
          startedAt: null,
        },
      },
    };
    writeRegistry(data);
    const read = readRegistry();
    assert.deepEqual(read, data);
  });

  it('ensurePluginsDir creates directory structure', () => {
    ensurePluginsDir();
    const paths = pluginPaths();
    assert.ok(existsSync(paths.pluginsDir));
    assert.ok(existsSync(paths.logsDir));
    assert.ok(existsSync(paths.packageJsonFile));
    const pkg = JSON.parse(readFileSync(paths.packageJsonFile, 'utf-8'));
    assert.equal(pkg.private, true);
  });

  it('ensurePluginsDir is idempotent', () => {
    ensurePluginsDir();
    ensurePluginsDir();
    assert.ok(existsSync(pluginPaths().pluginsDir));
  });

  it('readPluginMeta returns null when plugin not installed', () => {
    ensurePluginsDir();
    const meta = readPluginMeta('nonexistent-plugin');
    assert.equal(meta, null);
  });

  it('readPluginMeta reads plugin package.json', () => {
    ensurePluginsDir();
    const { pluginsDir } = pluginPaths();
    const pluginDir = join(pluginsDir, 'node_modules', 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
      name: 'test-plugin',
      version: '1.0.0',
      moxxy: { type: 'plugin', displayName: 'Test' },
      scripts: { 'plugin:start': 'node index.js' },
    }));
    const meta = readPluginMeta('test-plugin');
    assert.equal(meta.name, 'test-plugin');
    assert.equal(meta.moxxy.type, 'plugin');
  });

  it('readPluginMeta reads scoped package', () => {
    ensurePluginsDir();
    const { pluginsDir } = pluginPaths();
    const pluginDir = join(pluginsDir, 'node_modules', '@moxxy', 'web-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
      name: '@moxxy/web-plugin',
      version: '0.1.0',
      moxxy: { type: 'plugin', port: 5173 },
      scripts: { 'plugin:start': 'node server.js' },
    }));
    const meta = readPluginMeta('@moxxy/web-plugin');
    assert.equal(meta.name, '@moxxy/web-plugin');
    assert.equal(meta.moxxy.port, 5173);
  });

  it('validatePluginMeta accepts valid plugin', () => {
    const result = validatePluginMeta({
      name: 'test',
      moxxy: { type: 'plugin' },
      scripts: { 'plugin:start': 'node index.js' },
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('validatePluginMeta rejects null meta', () => {
    const result = validatePluginMeta(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('not found'));
  });

  it('validatePluginMeta rejects missing moxxy.type', () => {
    const result = validatePluginMeta({
      name: 'test',
      scripts: { 'plugin:start': 'node index.js' },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('moxxy.type')));
  });

  it('validatePluginMeta rejects wrong moxxy.type', () => {
    const result = validatePluginMeta({
      name: 'test',
      moxxy: { type: 'theme' },
      scripts: { 'plugin:start': 'node index.js' },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('moxxy.type')));
  });

  it('validatePluginMeta rejects missing plugin:start script', () => {
    const result = validatePluginMeta({
      name: 'test',
      moxxy: { type: 'plugin' },
      scripts: { start: 'node index.js' },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('plugin:start')));
  });

  it('validatePluginMeta rejects missing scripts entirely', () => {
    const result = validatePluginMeta({
      name: 'test',
      moxxy: { type: 'plugin' },
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('plugin:start')));
  });

  it('isProcessAlive returns false for non-existent PID', () => {
    assert.equal(isProcessAlive(999999), false);
  });

  it('isProcessAlive returns true for current process', () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it('sanitizeLogFileName handles scoped packages', () => {
    assert.equal(sanitizeLogFileName('@moxxy/web-plugin'), '@moxxy--web-plugin.log');
  });

  it('sanitizeLogFileName handles unscoped packages', () => {
    assert.equal(sanitizeLogFileName('my-plugin'), 'my-plugin.log');
  });

  it('sanitizeLogFileName handles deeply scoped names', () => {
    assert.equal(sanitizeLogFileName('@org/sub/pkg'), '@org--sub--pkg.log');
  });

  it('buildPluginEnv includes all required variables', () => {
    const env = buildPluginEnv('@moxxy/web-plugin', 5173);
    assert.equal(env.MOXXY_PLUGIN_NAME, '@moxxy/web-plugin');
    assert.equal(env.MOXXY_PLUGIN_PORT, '5173');
    assert.equal(env.PORT, '5173');
    assert.ok(env.MOXXY_API_URL);
    assert.ok(env.MOXXY_HOME);
    assert.equal(typeof env.MOXXY_TOKEN, 'string');
    assert.equal(env.VITE_MOXXY_API_URL, env.MOXXY_API_URL);
    assert.equal(env.VITE_MOXXY_TOKEN, env.MOXXY_TOKEN);
  });

  it('buildPluginEnv handles null port', () => {
    const env = buildPluginEnv('test-plugin', null);
    assert.equal(env.MOXXY_PLUGIN_PORT, '');
    assert.equal(env.PORT, '');
  });

  it('BUILTIN_PLUGINS contains web and virtual-office', () => {
    assert.equal(BUILTIN_PLUGINS.length, 2);
    const names = BUILTIN_PLUGINS.map(b => b.name);
    assert.ok(names.includes('@moxxy/web-plugin'));
    assert.ok(names.includes('@moxxy/virtual-office-plugin'));
  });

  it('BUILTIN_PLUGINS have required fields', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      assert.ok(plugin.name);
      assert.ok(plugin.label);
      assert.ok(plugin.hint);
      assert.ok(typeof plugin.defaultPort === 'number');
    }
  });
});
