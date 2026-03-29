import { getMoxxyHome } from '../commands/init.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_REGISTRY = { version: 1, plugins: {} };

export function pluginPaths() {
  const home = getMoxxyHome();
  const pluginsDir = join(home, 'plugins');
  const registryFile = join(pluginsDir, 'registry.json');
  const logsDir = join(pluginsDir, 'logs');
  const packageJsonFile = join(pluginsDir, 'package.json');
  return { pluginsDir, registryFile, logsDir, packageJsonFile };
}

export function readRegistry() {
  const { registryFile } = pluginPaths();
  if (!existsSync(registryFile)) return { ...DEFAULT_REGISTRY, plugins: {} };
  try {
    return JSON.parse(readFileSync(registryFile, 'utf-8'));
  } catch {
    return { ...DEFAULT_REGISTRY, plugins: {} };
  }
}

export function writeRegistry(registry) {
  const { registryFile } = pluginPaths();
  writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

export function ensurePluginsDir() {
  const { pluginsDir, logsDir, packageJsonFile } = pluginPaths();
  mkdirSync(pluginsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  if (!existsSync(packageJsonFile)) {
    writeFileSync(packageJsonFile, JSON.stringify({ private: true, dependencies: {} }, null, 2));
  }
}

export function readPluginMeta(pluginName) {
  const { pluginsDir } = pluginPaths();
  const pkgPath = join(pluginsDir, 'node_modules', pluginName, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function validatePluginMeta(meta) {
  const errors = [];
  if (!meta) {
    return { valid: false, errors: ['Plugin package.json not found'] };
  }
  if (!meta.moxxy || meta.moxxy.type !== 'plugin') {
    errors.push('Missing or invalid moxxy.type (must be "plugin")');
  }
  if (!meta.scripts || !meta.scripts['plugin:start']) {
    errors.push('Missing required script "plugin:start"');
  }
  return { valid: errors.length === 0, errors };
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeLogFileName(pluginName) {
  return pluginName.replace(/\//g, '--') + '.log';
}

export function buildPluginEnv(pluginName, port) {
  const apiUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  const token = process.env.MOXXY_TOKEN || '';
  return {
    ...process.env,
    MOXXY_API_URL: apiUrl,
    MOXXY_TOKEN: token,
    MOXXY_PLUGIN_NAME: pluginName,
    MOXXY_PLUGIN_PORT: port ? String(port) : '',
    MOXXY_HOME: getMoxxyHome(),
    PORT: port ? String(port) : '',
    // Vite exposes only VITE_-prefixed vars to browser code
    VITE_MOXXY_API_URL: apiUrl,
    VITE_MOXXY_TOKEN: token,
  };
}

export const BUILTIN_PLUGINS = [
  { name: '@moxxy/web-plugin', label: 'Web Dashboard', hint: 'browser-based dashboard', defaultPort: 5173 },
  { name: '@moxxy/virtual-office-plugin', label: 'Virtual Office', hint: 'virtual office environment', defaultPort: 17901 },
];
