/**
 * terminal.* handler tests: a fake CommandBus (the seam every transport uses)
 * over a REAL DeskStore at a temp `MOXXY_HOME` and REAL shells. The folder a
 * tab opens in is the chat's project's, found main-side.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import type { IpcCommandName, IpcEvents } from '@moxxy/desktop-ipc-contract';
import { DeskStore } from '../desks';
import { desktopEventBus } from '../event-bus';
import { TerminalTabs } from '../terminal-tabs';
import { setActiveBus } from './shared';
import { broadcastTerminalTabEvent, registerTerminalHandlers } from './terminal';
import { assertDefined } from '@moxxy/sdk';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

type Handler = (...args: unknown[]) => Promise<unknown>;

let home: string;
let originalHome: string | undefined;
let desks: DeskStore;
let tabs: TerminalTabs;
let handlers: Map<string, Handler>;
let offEvents: () => void;
const events: Array<{ channel: string; payload: unknown }> = [];

beforeEach(() => {
  home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'terminal-ipc-')));
  originalHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
  mkdirSync(path.join(home, 'sessions'), { recursive: true });
  desks = new DeskStore();
  handlers = new Map();
  setActiveBus({ handle: (channel: IpcCommandName, fn: Handler) => void handlers.set(channel, fn) } as unknown as CommandBus);
  tabs = new TerminalTabs({ emit: broadcastTerminalTabEvent });
  registerTerminalHandlers(desks, tabs);
  offEvents = desktopEventBus.addSink({
    broadcast: <K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]) => void events.push({ channel, payload }),
  });
});

afterEach(async () => {
  offEvents();
  events.length = 0;
  await tabs.closeAll();
  if (originalHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = originalHome;
  removeDirSync(home);
});

const invoke = (channel: string, args?: unknown): Promise<unknown> => {
  const handler = handlers.get(channel);
  assertDefined(handler, `handler for ${channel}`);
  return handler(args);
};

async function until(check: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
}

async function project(name: string): Promise<{ id: string; cwd: string }> {
  const cwd = path.join(home, name);
  mkdirSync(cwd, { recursive: true });
  const desk = await desks.create({ name, cwd });
  return { id: desk.id, cwd };
}

describe.skipIf(process.platform === 'win32')('terminal.* handlers', { timeout: 30_000 }, () => {
  it("opens a tab in the folder of the chat's project, shared by the project's other chats", async () => {
    const app = await project('app');
    const { session: second } = await desks.createSession(app.id);
    const tab = (await invoke('terminal.open', { workspaceId: app.id })) as { id: string; title: string };

    expect(await invoke('terminal.list', { workspaceId: second.id })).toEqual([{ id: tab.id, title: 'Terminal 1' }]);
    await invoke('terminal.input', { tabId: tab.id, data: 'pwd\r' });
    await until(() => events.some((e) => e.channel === 'terminal.data' && String((e.payload as { data: string }).data).includes(app.cwd)));
    expect(events).toContainEqual({ channel: 'terminal.tabsChanged', payload: { projectId: app.id } });
    expect(((await invoke('terminal.attach', { tabId: tab.id })) as { data: string }).data).toContain(app.cwd);
  });

  it('refuses a chat that belongs to no project, and lists nothing for it', async () => {
    await expect(invoke('terminal.open', { workspaceId: 'no-such-chat' })).rejects.toThrow();
    expect(await invoke('terminal.list', { workspaceId: 'no-such-chat' })).toEqual([]);
  });

  it('closes a tab, and closing a project closes its tabs', async () => {
    const app = await project('app');
    const other = await project('other');
    const a = (await invoke('terminal.open', { workspaceId: app.id })) as { id: string };
    await invoke('terminal.open', { workspaceId: app.id });
    await invoke('terminal.open', { workspaceId: other.id });

    await invoke('terminal.close', { tabId: a.id });
    expect(await invoke('terminal.attach', { tabId: a.id })).toBeNull();
    expect((await invoke('terminal.list', { workspaceId: app.id }) as unknown[]).length).toBe(1);

    await tabs.closeProject(app.id);
    expect(await invoke('terminal.list', { workspaceId: app.id })).toEqual([]);
    expect((await invoke('terminal.list', { workspaceId: other.id }) as unknown[]).length).toBe(1);
  });
});
