import { p, isInteractive, showResult } from '../ui.js';
import { parseFlags } from './auth.js';
import { getMoxxyHome } from './init.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const VALID_NETWORK_MODES = ['safe', 'unsafe'];

function settingsPath() {
  return join(getMoxxyHome(), 'settings.yaml');
}

function loadSettings() {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8');
    if (!raw.trim()) return {};
    const settings = {};
    for (const line of raw.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) settings[match[1]] = match[2].trim();
    }
    return settings;
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  const dir = getMoxxyHome();
  mkdirSync(dir, { recursive: true });
  const lines = Object.entries(settings).map(([k, v]) => `${k}: ${v}`);
  writeFileSync(settingsPath(), lines.join('\n') + '\n');
}

export function parseSettingsCommand(args) {
  const [action, ...rest] = args;
  const flags = parseFlags(rest);
  return { action, flags };
}

async function settingsGet(flags) {
  const settings = loadSettings();
  const key = flags.key;

  if (flags.json) {
    console.log(JSON.stringify(key ? { key, value: settings[key] ?? null } : settings, null, 2));
    return;
  }

  if (key) {
    const value = settings[key] ?? '(not set)';
    p.log.info(`${key}: ${value}`);
  } else {
    const entries = Object.entries(settings);
    if (entries.length === 0) {
      p.log.info('No settings configured. Using defaults.');
      p.log.info('  network_mode: safe (default)');
    } else {
      for (const [k, v] of entries) {
        p.log.info(`${k}: ${v}`);
      }
    }
  }
}

async function settingsSet(flags) {
  const key = flags.key;
  const value = flags.value;

  if (!key) throw new Error('Required: --key');
  if (value === undefined) throw new Error('Required: --value');

  // Validate known keys
  if (key === 'network_mode' && !VALID_NETWORK_MODES.includes(value)) {
    throw new Error(`Invalid network_mode '${value}'. Must be one of: ${VALID_NETWORK_MODES.join(', ')}`);
  }

  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);

  if (flags.json) {
    console.log(JSON.stringify({ status: 'updated', key, value }, null, 2));
  } else {
    showResult({ status: 'updated', key, value }, p);
  }
}

async function settingsNetworkMode(flags) {
  const settings = loadSettings();
  const current = settings.network_mode || 'safe';

  // No value provided — show current or toggle interactively
  if (!flags.mode && !flags._positional) {
    if (isInteractive()) {
      const selected = await p.select({
        message: `Network mode (currently: ${current})`,
        options: [
          { value: 'safe', label: 'Safe', hint: 'agent asks user before accessing non-allowlisted domains' },
          { value: 'unsafe', label: 'Unsafe', hint: 'domain allowlist is bypassed entirely' },
        ],
        initialValue: current,
      });
      if (p.isCancel(selected)) return;
      settings.network_mode = selected;
      saveSettings(settings);
      p.log.success(`Network mode set to: ${selected}`);
    } else {
      if (flags.json) {
        console.log(JSON.stringify({ network_mode: current }, null, 2));
      } else {
        p.log.info(`network_mode: ${current}`);
      }
    }
    return;
  }

  const mode = flags.mode || flags._positional;
  if (!VALID_NETWORK_MODES.includes(mode)) {
    throw new Error(`Invalid mode '${mode}'. Must be one of: ${VALID_NETWORK_MODES.join(', ')}`);
  }

  settings.network_mode = mode;
  saveSettings(settings);

  if (flags.json) {
    console.log(JSON.stringify({ status: 'updated', network_mode: mode }, null, 2));
  } else {
    p.log.success(`Network mode set to: ${mode}`);
  }
}

async function settingsBrowserRendering(flags) {
  const settings = loadSettings();
  const current = settings.browser_rendering === 'true';

  // No value provided — show current or toggle interactively
  if (!flags._positional) {
    if (isInteractive()) {
      const selected = await p.select({
        message: `Browser rendering (currently: ${current ? 'enabled' : 'disabled'})`,
        options: [
          { value: 'true', label: 'Enabled', hint: 'agents can render JS-heavy pages via headless Chrome' },
          { value: 'false', label: 'Disabled', hint: 'agents use HTTP-only browsing' },
        ],
        initialValue: current ? 'true' : 'false',
      });
      if (p.isCancel(selected)) return;
      settings.browser_rendering = selected;
      saveSettings(settings);
      p.log.success(`Browser rendering ${selected === 'true' ? 'enabled' : 'disabled'}.`);
    } else {
      if (flags.json) {
        console.log(JSON.stringify({ browser_rendering: current }, null, 2));
      } else {
        p.log.info(`browser_rendering: ${current}`);
      }
    }
    return;
  }

  const val = flags._positional;
  if (!['true', 'false', 'on', 'off', 'enable', 'disable'].includes(val)) {
    throw new Error(`Invalid value '${val}'. Use: true/false, on/off, or enable/disable`);
  }

  const enabled = ['true', 'on', 'enable'].includes(val);
  settings.browser_rendering = String(enabled);
  saveSettings(settings);

  if (flags.json) {
    console.log(JSON.stringify({ status: 'updated', browser_rendering: enabled }, null, 2));
  } else {
    p.log.success(`Browser rendering ${enabled ? 'enabled' : 'disabled'}.`);
  }
}

export async function runSettings(_client, args) {
  const { action, flags } = parseSettingsCommand(args);

  // Collect first positional arg after the action for convenience
  // e.g. `moxxy settings network-mode unsafe`
  const restArgs = args.slice(1).filter(a => !a.startsWith('--'));
  if (restArgs.length > 0 && !flags._positional) {
    flags._positional = restArgs[0];
  }

  switch (action) {
    case 'get':
      await settingsGet(flags);
      break;
    case 'set':
      await settingsSet(flags);
      break;
    case 'network-mode':
      await settingsNetworkMode(flags);
      break;
    case 'browser-rendering':
      await settingsBrowserRendering(flags);
      break;
    default:
      if (isInteractive() && !action) {
        // Interactive: show settings menu
        const selected = await p.select({
          message: 'Settings',
          options: [
            { value: 'network-mode', label: 'Network mode', hint: 'safe / unsafe domain access' },
            { value: 'browser-rendering', label: 'Browser rendering', hint: 'headless Chrome for JS-heavy sites' },
            { value: 'get', label: 'View all settings', hint: 'show current configuration' },
          ],
        });
        if (p.isCancel(selected)) return;
        await runSettings(_client, [selected]);
      } else {
        throw new Error(
          'Usage: moxxy settings <action>\n' +
          '  network-mode [safe|unsafe]         Get or set network mode\n' +
          '  browser-rendering [true|false]     Enable/disable headless Chrome rendering\n' +
          '  get [--key <k>]                    View settings\n' +
          '  set --key <k> --value <v>          Set a setting'
        );
      }
  }
}
