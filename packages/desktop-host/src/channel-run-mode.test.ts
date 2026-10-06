import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPrefs } from './prefs';
import {
  autostartChannels,
  runModeOf,
  setChannelRunMode,
  type ChannelProcessPort,
  type ChannelServicePort,
} from './channel-run-mode';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

/**
 * Real prefs file (temp MOXXY_HOME). The two ports are the external boundaries
 * — the OS service manager (launchd via `moxxy service`) and spawning the bot
 * subprocess — so they are in-memory stand-ins that record what happened.
 */
class FakeServices implements ChannelServicePort {
  readonly installed = new Set<string>();
  failInstall = false;
  async status(id: string) {
    return { installed: this.installed.has(id), running: this.installed.has(id) };
  }
  async install(id: string) {
    if (this.failInstall) throw new Error('launchctl bootstrap failed');
    this.installed.add(id);
  }
  async uninstall(id: string) {
    this.installed.delete(id);
  }
}

class FakeProcesses implements ChannelProcessPort {
  readonly running = new Set<string>();
  isRunning(id: string) {
    return this.running.has(id);
  }
  start(id: string) {
    this.running.add(id);
  }
  stop(id: string) {
    this.running.delete(id);
  }
}

let home: string;
const prevHome = process.env.MOXXY_HOME;
let services: FakeServices;
let processes: FakeProcesses;
const deps = (configured = true) => ({ services, processes, isConfigured: async () => configured });

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'moxxy-run-mode-'));
  process.env.MOXXY_HOME = home;
  services = new FakeServices();
  processes = new FakeProcesses();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prevHome;
  removeDirSync(home);
});

describe('channel run mode', () => {
  it('is manual until chosen otherwise', () => {
    expect(runModeOf(readPrefs(), 'discord')).toBe('manual');
  });

  it('ignores a corrupt stored mode', () => {
    expect(runModeOf({ ...readPrefs(), channelRunModes: { discord: 'forever' as never } }, 'discord')).toBe('manual');
  });

  it('"background" installs the service, stops the desktop-run copy (never two bots) and remembers it', async () => {
    processes.start('discord');

    await setChannelRunMode('discord', 'background', deps());

    expect(services.installed.has('discord')).toBe(true);
    expect(processes.isRunning('discord')).toBe(false);
    expect(runModeOf(readPrefs(), 'discord')).toBe('background');
  });

  it('does not remember "background" when installing the service fails', async () => {
    services.failInstall = true;

    await expect(setChannelRunMode('discord', 'background', deps())).rejects.toThrow(/launchctl/);
    expect(runModeOf(readPrefs(), 'discord')).toBe('manual');
  });

  it('"manual" removes the background service entirely — nothing keeps running or restarts at login', async () => {
    await setChannelRunMode('discord', 'background', deps());

    await setChannelRunMode('discord', 'manual', deps());

    expect(services.installed.has('discord')).toBe(false);
    expect(runModeOf(readPrefs(), 'discord')).toBe('manual');
  });

  it('"with the app" removes the service and starts the bot from the app right away', async () => {
    await setChannelRunMode('discord', 'background', deps());

    await setChannelRunMode('discord', 'app', deps());

    expect(services.installed.has('discord')).toBe(false);
    expect(processes.isRunning('discord')).toBe(true);
    expect(runModeOf(readPrefs(), 'discord')).toBe('app');
  });

  it('"with the app" on an unconfigured channel is remembered but starts nothing', async () => {
    await setChannelRunMode('discord', 'app', deps(false));
    expect(processes.isRunning('discord')).toBe(false);
  });
});

describe('autostartChannels (desktop launch)', () => {
  it('starts only configured channels set to "with the app"', async () => {
    await setChannelRunMode('discord', 'app', deps());
    processes.stop('discord');

    const started = await autostartChannels(['discord', 'telegram'], deps());

    expect(started).toEqual(['discord']);
    expect(processes.isRunning('discord')).toBe(true);
    expect(processes.isRunning('telegram')).toBe(false);
  });

  it('never starts a desktop copy of a channel that runs as a background service', async () => {
    await setChannelRunMode('discord', 'background', deps());

    expect(await autostartChannels(['discord'], deps())).toEqual([]);
    expect(processes.isRunning('discord')).toBe(false);
  });
});
