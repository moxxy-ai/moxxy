import { p, handleCancel, withSpinner, isInteractive, showResult } from '../ui.js';
import {
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
} from '../lib/plugin-registry.js';
import { execSync, spawn } from 'node:child_process';
import { existsSync, openSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { showHelp } from '../help.js';

// ── Lifecycle functions ──

async function installPlugin(pluginName) {
  ensurePluginsDir();
  const { pluginsDir } = pluginPaths();

  const registry = readRegistry();
  if (registry.plugins[pluginName]) {
    p.log.warn(`${pluginName} is already installed.`);
    return registry.plugins[pluginName];
  }

  await withSpinner(`Installing ${pluginName}...`, async () => {
    execSync(`npm install ${pluginName}`, { cwd: pluginsDir, stdio: 'pipe', timeout: 120_000 });
  }, `${pluginName} downloaded.`);

  const meta = readPluginMeta(pluginName);
  const { valid, errors } = validatePluginMeta(meta);
  if (!valid) {
    p.log.error(`Invalid plugin: ${errors.join(', ')}`);
    p.log.info('Removing invalid package...');
    try { execSync(`npm uninstall ${pluginName}`, { cwd: pluginsDir, stdio: 'pipe' }); } catch { /* best effort */ }
    return null;
  }

  // Run plugin:install hook if present
  if (meta.scripts?.['plugin:install']) {
    const pluginDir = join(pluginsDir, 'node_modules', pluginName);
    await withSpinner('Running post-install hook...', async () => {
      execSync('npm run plugin:install', { cwd: pluginDir, stdio: 'pipe', timeout: 120_000 });
    }, 'Post-install complete.');
  }

  const builtin = BUILTIN_PLUGINS.find(b => b.name === pluginName);
  const port = meta.moxxy?.port || builtin?.defaultPort || null;

  const entry = {
    name: pluginName,
    version: meta.version || '0.0.0',
    status: 'installed',
    enabled: false,
    builtin: !!builtin,
    pid: null,
    port,
    installedAt: new Date().toISOString(),
    startedAt: null,
  };

  registry.plugins[pluginName] = entry;
  writeRegistry(registry);

  showResult('Plugin installed', {
    Name: meta.moxxy?.displayName || pluginName,
    Version: entry.version,
    Port: port || 'none',
    Status: entry.status,
  });

  return entry;
}

async function startPlugin(pluginName) {
  const registry = readRegistry();
  const entry = registry.plugins[pluginName];
  if (!entry) {
    p.log.error(`${pluginName} is not installed. Install it first.`);
    return;
  }

  if (entry.status === 'running' && entry.pid && isProcessAlive(entry.pid)) {
    p.log.warn(`${pluginName} is already running (PID ${entry.pid}).`);
    return;
  }

  const meta = readPluginMeta(pluginName);
  if (!meta) {
    p.log.error(`Cannot read plugin metadata for ${pluginName}.`);
    return;
  }

  const { pluginsDir, logsDir } = pluginPaths();
  const pluginDir = join(pluginsDir, 'node_modules', pluginName);
  const logFile = join(logsDir, sanitizeLogFileName(pluginName));
  const port = entry.port || meta.moxxy?.port || null;
  const env = buildPluginEnv(pluginName, port);

  const logFd = openSync(logFile, 'a');

  const child = spawn('npm', ['run', 'plugin:start'], {
    cwd: pluginDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env,
  });

  child.unref();

  entry.status = 'running';
  entry.pid = child.pid;
  entry.startedAt = new Date().toISOString();
  writeRegistry(registry);

  // Verify health if plugin declares a port
  if (port) {
    let healthy = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const resp = await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) });
        if (resp.ok || resp.status < 500) {
          healthy = true;
          break;
        }
      } catch { /* retry */ }
    }
    if (healthy) {
      p.log.success(`${pluginName} started and listening on port ${port} (PID ${child.pid})`);
    } else {
      p.log.warn(`${pluginName} started (PID ${child.pid}) but port ${port} not responding yet.`);
      p.log.info(`Check logs with: moxxy plugin logs ${pluginName}`);
    }
  } else {
    p.log.success(`${pluginName} started (PID ${child.pid}).`);
  }
}

async function stopPlugin(pluginName) {
  const registry = readRegistry();
  const entry = registry.plugins[pluginName];
  if (!entry) {
    p.log.error(`${pluginName} is not installed.`);
    return;
  }

  if (!entry.pid || !isProcessAlive(entry.pid)) {
    p.log.warn(`${pluginName} is not running.`);
    entry.status = 'stopped';
    entry.pid = null;
    entry.startedAt = null;
    writeRegistry(registry);
    return;
  }

  // Run plugin:stop hook if present
  const meta = readPluginMeta(pluginName);
  if (meta?.scripts?.['plugin:stop']) {
    const { pluginsDir } = pluginPaths();
    const pluginDir = join(pluginsDir, 'node_modules', pluginName);
    const env = buildPluginEnv(pluginName, entry.port);
    try {
      execSync('npm run plugin:stop', { cwd: pluginDir, env, stdio: 'pipe', timeout: 5000 });
    } catch { /* best effort */ }
  }

  try {
    process.kill(entry.pid, 'SIGTERM');
    p.log.success(`${pluginName} stopped (PID ${entry.pid}).`);
  } catch (err) {
    if (err.code === 'ESRCH') {
      p.log.warn(`Process ${entry.pid} not found. Cleaning up stale entry.`);
    } else {
      throw err;
    }
  }

  entry.status = 'stopped';
  entry.pid = null;
  entry.startedAt = null;
  writeRegistry(registry);
}

async function restartPlugin(pluginName) {
  p.log.step('Stopping plugin...');
  await stopPlugin(pluginName);
  await new Promise(r => setTimeout(r, 1000));
  p.log.step('Starting plugin...');
  await startPlugin(pluginName);
}

async function updatePlugin(pluginName) {
  const registry = readRegistry();
  const entry = registry.plugins[pluginName];
  if (!entry) {
    p.log.error(`${pluginName} is not installed.`);
    return;
  }

  const { pluginsDir } = pluginPaths();
  const wasRunning = entry.pid && isProcessAlive(entry.pid);
  const oldVersion = entry.version;

  // Stop if running
  if (wasRunning) {
    p.log.step('Stopping plugin before update...');
    await stopPlugin(pluginName);
  }

  // Re-fetch the latest package
  await withSpinner(`Updating ${pluginName}...`, async () => {
    execSync(`npm install ${pluginName}@latest`, { cwd: pluginsDir, stdio: 'pipe', timeout: 120_000 });
  }, `${pluginName} downloaded.`);

  const meta = readPluginMeta(pluginName);
  const { valid, errors } = validatePluginMeta(meta);
  if (!valid) {
    p.log.error(`Updated package is invalid: ${errors.join(', ')}`);
    p.log.info('Rolling back...');
    try { execSync(`npm install ${pluginName}@${oldVersion}`, { cwd: pluginsDir, stdio: 'pipe', timeout: 120_000 }); } catch { /* best effort */ }
    if (wasRunning) await startPlugin(pluginName);
    return;
  }

  // Run plugin:install hook if present (post-update setup)
  if (meta.scripts?.['plugin:install']) {
    const pluginDir = join(pluginsDir, 'node_modules', pluginName);
    await withSpinner('Running post-install hook...', async () => {
      execSync('npm run plugin:install', { cwd: pluginDir, stdio: 'pipe', timeout: 120_000 });
    }, 'Post-install complete.');
  }

  const newVersion = meta.version || '0.0.0';
  entry.version = newVersion;
  writeRegistry(registry);

  // Restart if it was running before
  if (wasRunning) {
    p.log.step('Restarting plugin...');
    await startPlugin(pluginName);
  }

  if (oldVersion === newVersion) {
    p.log.success(`${pluginName} is already at the latest version (v${newVersion}).`);
  } else {
    showResult('Plugin updated', {
      Name: meta.moxxy?.displayName || pluginName,
      'Old version': oldVersion,
      'New version': newVersion,
    });
  }
}

async function uninstallPlugin(pluginName) {
  const registry = readRegistry();
  const entry = registry.plugins[pluginName];
  if (!entry) {
    p.log.error(`${pluginName} is not installed.`);
    return;
  }

  // Stop if running
  if (entry.pid && isProcessAlive(entry.pid)) {
    await stopPlugin(pluginName);
  }

  // Run plugin:uninstall hook if present
  const meta = readPluginMeta(pluginName);
  if (meta?.scripts?.['plugin:uninstall']) {
    const { pluginsDir } = pluginPaths();
    const pluginDir = join(pluginsDir, 'node_modules', pluginName);
    const env = buildPluginEnv(pluginName, entry.port);
    try {
      execSync('npm run plugin:uninstall', { cwd: pluginDir, env, stdio: 'pipe', timeout: 10_000 });
    } catch { /* best effort */ }
  }

  const { pluginsDir, logsDir } = pluginPaths();
  await withSpinner(`Uninstalling ${pluginName}...`, async () => {
    execSync(`npm uninstall ${pluginName}`, { cwd: pluginsDir, stdio: 'pipe', timeout: 60_000 });
  }, `${pluginName} removed.`);

  // Clean log file
  const logFile = join(logsDir, sanitizeLogFileName(pluginName));
  try { unlinkSync(logFile); } catch { /* may not exist */ }

  delete registry.plugins[pluginName];
  writeRegistry(registry);

  p.log.success(`${pluginName} uninstalled.`);
}

function enablePlugin(pluginName) {
  const registry = readRegistry();
  const entry = registry.plugins[pluginName];
  if (!entry) {
    p.log.error(`${pluginName} is not installed.`);
    return;
  }
  entry.enabled = true;
  writeRegistry(registry);
  p.log.success(`${pluginName} enabled for auto-start.`);
}

function disablePlugin(pluginName) {
  const registry = readRegistry();
  const entry = registry.plugins[pluginName];
  if (!entry) {
    p.log.error(`${pluginName} is not installed.`);
    return;
  }
  entry.enabled = false;
  writeRegistry(registry);
  p.log.success(`${pluginName} disabled for auto-start.`);
}

async function pluginLogs(pluginName) {
  const { logsDir } = pluginPaths();
  const logFile = join(logsDir, sanitizeLogFileName(pluginName));

  if (!existsSync(logFile)) {
    p.log.warn(`No log file found at ${logFile}`);
    return;
  }

  p.log.info(`Tailing ${logFile} (Ctrl+C to stop)`);

  let tail;
  if (platform() === 'win32') {
    tail = spawn('powershell', ['-Command', `Get-Content -Path "${logFile}" -Wait -Tail 50`], { stdio: 'inherit' });
  } else {
    tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
  }

  await new Promise((resolve) => {
    process.on('SIGINT', () => {
      tail.kill();
      resolve();
    });
    tail.on('close', resolve);
  });
}

function listPlugins() {
  const registry = readRegistry();
  const plugins = Object.values(registry.plugins);

  if (plugins.length === 0) {
    p.log.info('No plugins installed.');
    p.log.info('Install one with: moxxy plugin install <package>');
    return;
  }

  for (const plug of plugins) {
    const alive = plug.pid && isProcessAlive(plug.pid);
    const statusIcon = alive ? '\u2705' : plug.status === 'error' ? '\u274c' : '\u23f8\ufe0f';
    const status = alive ? 'running' : plug.status === 'error' ? 'error' : 'stopped';
    const autoStart = plug.enabled ? ' [auto-start]' : '';
    const builtinTag = plug.builtin ? ' (built-in)' : '';
    const portInfo = plug.port ? ` :${plug.port}` : '';

    p.log.info(`${statusIcon}  ${plug.name} v${plug.version} [${status}]${portInfo}${autoStart}${builtinTag}`);
  }
}

// ── Interactive menu ──

async function interactiveMenu(client) {
  const action = await p.select({
    message: 'Plugin action',
    options: [
      { value: 'list', label: 'List', hint: 'show installed plugins' },
      { value: 'install', label: 'Install', hint: 'install a new plugin' },
      { value: 'manage', label: 'Manage', hint: 'start/stop/uninstall a plugin' },
    ],
  });
  handleCancel(action);

  switch (action) {
    case 'list':
      listPlugins();
      break;
    case 'install':
      await interactiveInstall();
      break;
    case 'manage':
      await interactiveManage();
      break;
  }
}

async function interactiveInstall() {
  const registry = readRegistry();

  const options = BUILTIN_PLUGINS.map(b => ({
    value: b.name,
    label: b.label,
    hint: `${b.hint}${registry.plugins[b.name] ? ' (installed)' : ''}`,
  }));
  options.push({ value: '__custom__', label: 'Custom', hint: 'enter an npm package name' });

  const selected = await p.select({
    message: 'Choose a plugin to install',
    options,
  });
  handleCancel(selected);

  let pluginName = selected;
  if (selected === '__custom__') {
    pluginName = await p.text({
      message: 'Enter npm package name',
      placeholder: 'my-plugin or @scope/my-plugin',
      validate: (v) => {
        if (!v || !v.trim()) return 'Package name is required';
      },
    });
    handleCancel(pluginName);
    pluginName = pluginName.trim();
  }

  await installPlugin(pluginName);
}

async function interactiveManage() {
  const registry = readRegistry();
  const plugins = Object.values(registry.plugins);

  if (plugins.length === 0) {
    p.log.info('No plugins installed. Install one first.');
    return;
  }

  const selected = await p.select({
    message: 'Select a plugin to manage',
    options: plugins.map(plug => {
      const alive = plug.pid && isProcessAlive(plug.pid);
      const status = alive ? 'running' : 'stopped';
      return {
        value: plug.name,
        label: plug.name,
        hint: `v${plug.version} [${status}]${plug.builtin ? ' (built-in)' : ''}`,
      };
    }),
  });
  handleCancel(selected);

  const entry = registry.plugins[selected];
  const alive = entry.pid && isProcessAlive(entry.pid);

  const actions = [];
  if (!alive) {
    actions.push({ value: 'start', label: 'Start', hint: 'start the plugin' });
  }
  if (alive) {
    actions.push({ value: 'stop', label: 'Stop', hint: 'stop the plugin' });
    actions.push({ value: 'restart', label: 'Restart', hint: 'restart the plugin' });
  }
  if (entry.enabled) {
    actions.push({ value: 'disable', label: 'Disable auto-start', hint: 'disable automatic startup' });
  } else {
    actions.push({ value: 'enable', label: 'Enable auto-start', hint: 'enable automatic startup' });
  }
  actions.push({ value: 'update', label: 'Update', hint: 're-fetch the latest version' });
  actions.push({ value: 'logs', label: 'Logs', hint: 'tail plugin logs' });
  actions.push({ value: 'uninstall', label: 'Uninstall', hint: 'remove the plugin' });

  const action = await p.select({
    message: `Action for ${selected}`,
    options: actions,
  });
  handleCancel(action);

  switch (action) {
    case 'start':
      await startPlugin(selected);
      break;
    case 'stop':
      await stopPlugin(selected);
      break;
    case 'restart':
      await restartPlugin(selected);
      break;
    case 'enable':
      enablePlugin(selected);
      break;
    case 'disable':
      disablePlugin(selected);
      break;
    case 'update':
      await updatePlugin(selected);
      break;
    case 'logs':
      await pluginLogs(selected);
      break;
    case 'uninstall':
      await uninstallPlugin(selected);
      break;
  }
}

// ── CLI subcommand helpers ──

function resolvePluginName(args) {
  const name = args.join(' ').trim();
  if (!name) {
    p.log.error('Plugin name is required.');
    return null;
  }
  return name;
}

// ── Command router ──

export async function runPlugin(client, args) {
  const sub = args[0];

  switch (sub) {
    case 'list':
      listPlugins();
      break;
    case 'install': {
      const name = resolvePluginName(args.slice(1));
      if (name) await installPlugin(name);
      break;
    }
    case 'start': {
      const name = resolvePluginName(args.slice(1));
      if (name) await startPlugin(name);
      break;
    }
    case 'stop': {
      const name = resolvePluginName(args.slice(1));
      if (name) await stopPlugin(name);
      break;
    }
    case 'restart': {
      const name = resolvePluginName(args.slice(1));
      if (name) await restartPlugin(name);
      break;
    }
    case 'update': {
      const name = resolvePluginName(args.slice(1));
      if (name) await updatePlugin(name);
      break;
    }
    case 'uninstall': {
      const name = resolvePluginName(args.slice(1));
      if (name) await uninstallPlugin(name);
      break;
    }
    case 'logs': {
      const name = resolvePluginName(args.slice(1));
      if (name) await pluginLogs(name);
      break;
    }
    case 'enable': {
      const name = resolvePluginName(args.slice(1));
      if (name) enablePlugin(name);
      break;
    }
    case 'disable': {
      const name = resolvePluginName(args.slice(1));
      if (name) disablePlugin(name);
      break;
    }
    default:
      if (!sub && isInteractive()) {
        await interactiveMenu(client);
      } else if (sub) {
        p.log.error(`Unknown plugin action: ${sub}`);
        showHelp('plugin', p);
      } else {
        showHelp('plugin', p);
      }
  }
}
