/**
 * How a desktop-runnable channel runs — `manual` (Start/Stop in the panel),
 * `app` (starts with the desktop) or `background` (an OS service, online 24/7
 * even with the app closed). The one rule every transition keeps: a channel
 * never runs twice (desktop child + background service would both answer with
 * the same bot token). Leaving `background` REMOVES the service — launchd's
 * KeepAlive would resurrect a merely stopped one — so "off" really means off.
 *
 * Electron-free: the OS service manager and the bot subprocess are ports.
 */

import type { ChannelRunMode, DesktopPrefs } from '@moxxy/desktop-ipc-contract';
import { readPrefs, updatePrefs } from './prefs';

/** The OS background-service manager (launchd / systemd via `moxxy service`). */
export interface ChannelServicePort {
  status(id: string): Promise<{ readonly installed: boolean; readonly running: boolean }>;
  install(id: string): Promise<void>;
  uninstall(id: string): Promise<void>;
}

/** The desktop-spawned bot subprocess (the channel supervisor). */
export interface ChannelProcessPort {
  isRunning(id: string): boolean;
  start(id: string): void;
  stop(id: string): void;
}

export interface ChannelRunModeDeps {
  readonly services: ChannelServicePort;
  readonly processes: ChannelProcessPort;
  readonly isConfigured: (id: string) => Promise<boolean>;
}

const RUN_MODES: ReadonlySet<string> = new Set<ChannelRunMode>(['manual', 'app', 'background']);

export function runModeOf(prefs: DesktopPrefs, id: string): ChannelRunMode {
  const stored: unknown = prefs.channelRunModes[id];
  return typeof stored === 'string' && RUN_MODES.has(stored) ? (stored as ChannelRunMode) : 'manual';
}

async function remember(id: string, mode: ChannelRunMode): Promise<void> {
  const current = readPrefs().channelRunModes;
  await updatePrefs({ channelRunModes: { ...current, [id]: mode } });
}

export async function setChannelRunMode(
  id: string,
  mode: ChannelRunMode,
  deps: ChannelRunModeDeps,
): Promise<void> {
  if (mode === 'background') {
    if (deps.processes.isRunning(id)) deps.processes.stop(id);
    await deps.services.install(id);
    await remember(id, mode);
    return;
  }
  if ((await deps.services.status(id)).installed) await deps.services.uninstall(id);
  await remember(id, mode);
  if (mode === 'app' && !deps.processes.isRunning(id) && (await deps.isConfigured(id))) {
    deps.processes.start(id);
  }
}

/** Desktop launch: start the configured channels set to run with the app. */
export async function autostartChannels(
  ids: ReadonlyArray<string>,
  deps: ChannelRunModeDeps,
): Promise<string[]> {
  const prefs = readPrefs();
  const started: string[] = [];
  for (const id of ids) {
    if (runModeOf(prefs, id) !== 'app' || deps.processes.isRunning(id)) continue;
    if (!(await deps.isConfigured(id))) continue;
    deps.processes.start(id);
    started.push(id);
  }
  return started;
}
