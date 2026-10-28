/**
 * The person's terminal tabs (`terminal.*`). The shells are main-owned
 * ({@link TerminalTabs}), one set per project: a tab opens in the folder of
 * the project the chat belongs to, found here, never taken from the renderer.
 * The agent's terminal is not here: it is the runner's `terminal` surface.
 */

import type { DeskStore } from '../desks';
import { broadcastHostEvent } from '../event-bus';
import { TerminalTabs, type TerminalTabEvent } from '../terminal-tabs';
import { handle, IpcError } from './shared';

/** Each tab event as the IPC event every window hears. */
export function broadcastTerminalTabEvent(event: TerminalTabEvent): void {
  if (event.type === 'data') broadcastHostEvent('terminal.data', { tabId: event.tabId, data: event.data });
  else if (event.type === 'exit') broadcastHostEvent('terminal.exit', { tabId: event.tabId, code: event.code });
  else broadcastHostEvent('terminal.tabsChanged', { projectId: event.projectId });
}

let appTabs: TerminalTabs | null = null;

/** The app's terminal tabs, made on first use; quitting closes them ({@link closeAllTerminalTabs}). */
export function terminalTabs(): TerminalTabs {
  appTabs ??= new TerminalTabs({ emit: broadcastTerminalTabEvent });
  return appTabs;
}

/** Stop every tab and what was started from it (app quit). */
export async function closeAllTerminalTabs(): Promise<void> {
  await appTabs?.closeAll();
}

export function registerTerminalHandlers(desks: DeskStore, tabs: TerminalTabs = terminalTabs()): void {
  const projectOf = async (workspaceId: string) =>
    (await desks.deskForSession(workspaceId)) ?? (await desks.list()).find((desk) => desk.id === workspaceId) ?? null;

  handle('terminal.list', async ({ workspaceId }) => {
    const desk = await projectOf(workspaceId);
    return desk ? tabs.list(desk.id) : [];
  });
  handle('terminal.open', async ({ workspaceId }) => {
    const desk = await projectOf(workspaceId);
    if (!desk) throw new IpcError('no-workspace', `No project for chat ${workspaceId}`);
    return tabs.open(desk.id, desk.cwd);
  });
  handle('terminal.attach', async ({ tabId }) => tabs.attach(tabId));
  handle('terminal.input', async ({ tabId, data }) => tabs.input(tabId, data));
  handle('terminal.resize', async ({ tabId, cols, rows }) => tabs.resize(tabId, cols, rows));
  handle('terminal.close', async ({ tabId }) => tabs.close(tabId));
}
