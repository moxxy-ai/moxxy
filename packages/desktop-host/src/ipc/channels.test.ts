import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import type { ChannelEntry, ChannelRuntimeStatus, IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import { setActiveBus } from './shared';
import { autostartConfiguredChannels, registerChannelsHandlers } from './channels';
import type { ChannelProcessPort, ChannelServicePort } from '../channel-run-mode';

/** OS service manager + bot subprocess — the external boundaries, recorded in memory. */
function fakeServices(): ChannelServicePort & { installed: Set<string> } {
  const installed = new Set<string>();
  return {
    installed,
    status: async (id) => ({ installed: installed.has(id), running: installed.has(id) }),
    install: async (id) => void installed.add(id),
    uninstall: async (id) => void installed.delete(id),
  };
}
function fakeProcesses(): ChannelProcessPort & { running: Set<string> } {
  const running = new Set<string>();
  return {
    running,
    isRunning: (id) => running.has(id),
    start: (id) => void running.add(id),
    stop: (id) => void running.delete(id),
  };
}

type Handler = (...args: unknown[]) => Promise<unknown>;

let tmp: string;
let vault: VaultStore;
let handlers: Map<string, Handler>;
let services: ReturnType<typeof fakeServices>;
let processes: ReturnType<typeof fakeProcesses>;
const prevHome = process.env.MOXXY_HOME;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-dh-channels-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  process.env.MOXXY_HOME = tmp;
  services = fakeServices();
  processes = fakeProcesses();
  handlers = new Map();
  setActiveBus({
    handle: (channel: IpcCommandName, handler: Handler) => handlers.set(channel, handler),
  } as unknown as CommandBus);
  registerChannelsHandlers({ vault: () => vault, services, processes });
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prevHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

function call<T>(name: string, args?: unknown): Promise<T> {
  const h = handlers.get(name);
  if (!h) throw new Error(`no handler for ${name}`);
  return h(args) as Promise<T>;
}

describe('channels.setModel', () => {
  it('stores the bot model channel-scoped and reports it in the status + list', async () => {
    const status = await call<ChannelRuntimeStatus>('channels.setModel', {
      channelId: 'discord',
      model: 'openai-codex::gpt-5.6-luna',
    });

    expect(status.model).toBe('openai-codex::gpt-5.6-luna');
    expect(await vault.get('discord_model')).toBe('openai-codex::gpt-5.6-luna');
    const list = await call<ReadonlyArray<ChannelEntry>>('channels.list');
    expect(list.find((e) => e.descriptor.id === 'discord')?.status.model).toBe('openai-codex::gpt-5.6-luna');
  });

  it('null resets the bot to the default model', async () => {
    await vault.set('discord_model', 'openai-codex::gpt-5.6-luna');

    const status = await call<ChannelRuntimeStatus>('channels.setModel', { channelId: 'discord', model: null });

    expect(status.model).toBeUndefined();
    expect(await vault.get('discord_model')).toBeNull();
  });

  it('refuses channels that do not support a per-channel model', async () => {
    await expect(call('channels.setModel', { channelId: 'slack', model: 'p::m' })).rejects.toThrow(/model/);
  });

  it('advertises model support only for channels that have it', async () => {
    const list = await call<ReadonlyArray<ChannelEntry>>('channels.list');
    expect(list.find((e) => e.descriptor.id === 'discord')?.descriptor.supportsModel).toBe(true);
    expect(list.find((e) => e.descriptor.id === 'slack')?.descriptor.supportsModel).toBeFalsy();
  });
});

describe('channels.setRunMode', () => {
  beforeEach(async () => {
    await vault.set('discord_bot_token', 'token');
  });

  it('runs the bot as a background service and reports it', async () => {
    const status = await call<ChannelRuntimeStatus>('channels.setRunMode', { channelId: 'discord', mode: 'background' });

    expect(status.runMode).toBe('background');
    expect(status.background).toEqual({ installed: true, running: true });
    expect(services.installed.has('discord')).toBe(true);
  });

  it('refuses to Start a desktop copy while the background service runs it', async () => {
    await call('channels.setRunMode', { channelId: 'discord', mode: 'background' });

    await expect(call('channels.start', { channelId: 'discord' })).rejects.toThrow(/background/);
    expect(processes.running.has('discord')).toBe(false);
  });

  it('switching back to manual removes the service', async () => {
    await call('channels.setRunMode', { channelId: 'discord', mode: 'background' });

    const status = await call<ChannelRuntimeStatus>('channels.setRunMode', { channelId: 'discord', mode: 'manual' });

    expect(status.runMode).toBe('manual');
    expect(status.background).toBeUndefined();
    expect(services.installed.has('discord')).toBe(false);
  });

  it('lists the run mode only for channels that support it', async () => {
    const list = await call<ReadonlyArray<ChannelEntry>>('channels.list');
    const discord = list.find((e) => e.descriptor.id === 'discord');
    expect(discord?.descriptor.supportsBackground).toBe(true);
    expect(discord?.status.runMode).toBe('manual');
    expect(list.find((e) => e.descriptor.id === 'slack')?.status.runMode).toBeUndefined();
  });

  it('refuses channels without run-mode support', async () => {
    await expect(call('channels.setRunMode', { channelId: 'slack', mode: 'app' })).rejects.toThrow(/run mode/);
  });
});

describe('autostartConfiguredChannels (desktop launch)', () => {
  it('starts configured channels set to run with the app', async () => {
    await vault.set('discord_bot_token', 'token');
    await call('channels.setRunMode', { channelId: 'discord', mode: 'app' });
    processes.running.clear();

    const started = await autostartConfiguredChannels({ vault: () => vault, services, processes });

    expect(started).toEqual(['discord']);
    expect(processes.running.has('discord')).toBe(true);
  });
});

describe('channels.history (read-only bot conversation)', () => {
  it("pages the channel's sticky session log", async () => {
    const reads: Array<[string, unknown]> = [];
    const page = { events: [], prevCursor: null };
    registerChannelsHandlers({
      vault: () => vault,
      services,
      processes,
      readHistory: async (sessionId, opts) => {
        reads.push([sessionId, opts]);
        return page;
      },
    });

    const out = await call('channels.history', { channelId: 'discord', before: 50, limit: 100 });

    expect(out).toBe(page);
    expect(reads).toEqual([['moxxy-channel-discord', { before: 50, limit: 100 }]]);
  });

  it('returns null while the bot has no conversation yet', async () => {
    registerChannelsHandlers({
      vault: () => vault,
      services,
      processes,
      readHistory: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(await call('channels.history', { channelId: 'discord', before: null, limit: 100 })).toBeNull();
  });

  it('only reads catalog channels (never a renderer-chosen session)', async () => {
    await expect(call('channels.history', { channelId: 'nope', before: null, limit: 10 })).rejects.toThrow(/unknown channel/);
  });
});
