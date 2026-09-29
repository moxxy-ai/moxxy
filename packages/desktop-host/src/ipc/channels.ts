/**
 * Communication-channel IPC: list / configure / start / stop the desktop-runnable
 * channels (Slack, Telegram), each on its own dedicated, isolated runner.
 *
 * Secrets are written to the SAME in-process vault the runner reads (so a token
 * saved here is immediately resolvable by the spawned channel), keyed by the
 * vault names the channel plugins actually read (see {@link CHANNEL_CATALOG}).
 * The subprocess lifecycle lives in {@link ChannelSupervisor}; these handlers are
 * the thin IPC + "configured?" (vault) glue.
 *
 * Host-only: these run a local subprocess + read/write the vault, so they are
 * deliberately NOT in REMOTE_ALLOWED_COMMANDS — a paired phone can't start a
 * channel or save its secrets over the WS bridge.
 */

import { channelRunnerSocket, channelSessionId } from '@moxxy/runner';
import type { ChannelEntry, ChannelRuntimeStatus } from '@moxxy/desktop-ipc-contract';
import type { InProcessPlugins } from '../in-process-plugins';
import { getInProcessPlugins, handle, IpcError } from './shared';
import { CHANNEL_CATALOG, listChannelCatalog, type ChannelCatalogEntry } from '../channel-catalog';
import { channelRuntime, startChannel, stopChannel } from '../channel-supervisor';
import {
  autostartChannels,
  runModeOf,
  setChannelRunMode,
  type ChannelProcessPort,
  type ChannelServicePort,
} from '../channel-run-mode';
import { createCliServicePort } from '../channel-service-cli';
import { readPrefs } from '../prefs';

type Vault = InProcessPlugins['vault'];

export interface ChannelsHandlerDependencies {
  /** The vault the spawned channels read (defaults to the in-process one). */
  readonly vault: () => Vault;
  /** The OS background-service manager (defaults to `moxxy service`). */
  readonly services: ChannelServicePort;
  /** The desktop-spawned bot subprocesses (defaults to the channel supervisor). */
  readonly processes: ChannelProcessPort;
  /** Attach the desktop to a bot's own runner (the runner pool's attach-only
   *  entry), so its conversation is an ordinary chat keyed by `sessionId`. */
  readonly attachChat: (sessionId: string, socketPath: string) => Promise<void>;
}

/** The channel supervisor as the run-mode process port. */
export const supervisorProcesses: ChannelProcessPort = {
  isRunning: (id) => channelRuntime(id).running,
  start: startChannel,
  stop: stopChannel,
};

/** Configured == every required secret is present in the vault. */
async function isConfigured(vault: Vault, entry: ChannelCatalogEntry): Promise<boolean> {
  for (const key of entry.requiredKeys) {
    if (!(await vault.has(key))) return false;
  }
  return true;
}

/** Merge the supervisor's live runtime with the vault/prefs-derived state. The
 *  background service is only queried while it is the chosen run mode. */
async function statusOf(
  vault: Vault,
  entry: ChannelCatalogEntry,
  services: ChannelServicePort,
): Promise<ChannelRuntimeStatus> {
  const id = entry.descriptor.id;
  const rt = channelRuntime(id);
  const model = entry.modelVaultKey ? await vault.get(entry.modelVaultKey) : null;
  const runMode = entry.descriptor.supportsBackground ? runModeOf(readPrefs(), id) : undefined;
  const background = runMode === 'background' ? await services.status(id) : undefined;
  return {
    id,
    configured: await isConfigured(vault, entry),
    running: rt.running,
    ...(rt.pid !== undefined ? { pid: rt.pid } : {}),
    ...(rt.startedAtMs !== undefined ? { startedAtMs: rt.startedAtMs } : {}),
    ...(rt.requestUrl !== undefined ? { requestUrl: rt.requestUrl } : {}),
    ...(rt.connected !== undefined ? { connected: rt.connected } : {}),
    ...(rt.error !== undefined ? { error: rt.error } : {}),
    ...(model ? { model } : {}),
    ...(runMode ? { runMode } : {}),
    ...(background ? { background } : {}),
  };
}

function catalogEntry(channelId: string): ChannelCatalogEntry {
  const entry = CHANNEL_CATALOG[channelId];
  if (!entry) throw new IpcError('not-supported', `unknown channel: ${channelId}`);
  return entry;
}

export function registerChannelsHandlers(
  dependencies: Partial<ChannelsHandlerDependencies> = {},
): void {
  const vault = dependencies.vault ?? (() => getInProcessPlugins().vault);
  const services = dependencies.services ?? createCliServicePort();
  const processes = dependencies.processes ?? supervisorProcesses;
  const attachChat = dependencies.attachChat;
  const status = (entry: ChannelCatalogEntry) => statusOf(vault(), entry, services);

  handle('channels.list', async () => {
    const out: ChannelEntry[] = [];
    for (const entry of listChannelCatalog()) {
      out.push({ descriptor: entry.descriptor, status: await status(entry) });
    }
    return out;
  });

  handle('channels.saveConfig', async ({ channelId, values }) => {
    const entry = catalogEntry(channelId);
    for (const [field, value] of Object.entries(values)) {
      const key = entry.vaultKeys[field];
      if (!key) {
        throw new IpcError('invalid-payload', `unknown config field for ${channelId}: ${field}`);
      }
      const trimmed = value.trim();
      // Skip blanks: an untouched password field comes back empty and must not
      // wipe a previously-saved secret.
      if (trimmed) await vault().set(key, trimmed);
    }
    return status(entry);
  });

  handle('channels.setModel', async ({ channelId, model }) => {
    const entry = catalogEntry(channelId);
    if (!entry.modelVaultKey) {
      throw new IpcError('not-supported', `${channelId} does not support choosing a model`);
    }
    if (model) await vault().set(entry.modelVaultKey, model);
    else await vault().delete(entry.modelVaultKey);
    return status(entry);
  });

  handle('channels.openChat', async ({ channelId }) => {
    // Catalog-only id → the bot's fixed socket + sticky session; the renderer
    // never names a socket or a session itself.
    const id = catalogEntry(channelId).descriptor.id;
    if (!attachChat) throw new IpcError('not-supported', 'channel chats are not available here');
    const workspaceId = channelSessionId(id);
    await attachChat(workspaceId, channelRunnerSocket(id));
    return { workspaceId };
  });

  handle('channels.setRunMode', async ({ channelId, mode }) => {
    const entry = catalogEntry(channelId);
    if (!entry.descriptor.supportsBackground) {
      throw new IpcError('not-supported', `${channelId} does not support choosing a run mode`);
    }
    try {
      await setChannelRunMode(channelId, mode, {
        services,
        processes,
        isConfigured: async () => isConfigured(vault(), entry),
      });
    } catch (e) {
      throw new IpcError('runner-error', e instanceof Error ? e.message : `failed to set run mode`);
    }
    return status(entry);
  });

  handle('channels.start', async ({ channelId }) => {
    const entry = catalogEntry(channelId);
    if (!(await isConfigured(vault(), entry))) {
      throw new IpcError('runner-error', `${channelId} is not configured yet`);
    }
    // Never a second copy of a bot the background service already runs.
    if (entry.descriptor.supportsBackground && runModeOf(readPrefs(), channelId) === 'background') {
      throw new IpcError(
        'runner-error',
        `${channelId} runs as a background service — switch its run mode to Manual to control it here`,
      );
    }
    try {
      processes.start(channelId);
    } catch (e) {
      throw new IpcError(
        'runner-error',
        e instanceof Error ? e.message : `failed to start ${channelId}`,
      );
    }
    return status(entry);
  });

  handle('channels.stop', async ({ channelId }) => {
    const entry = catalogEntry(channelId);
    processes.stop(channelId);
    return status(entry);
  });
}

/**
 * Desktop launch: start the configured channels whose run mode is "with the
 * app". Background-service channels are launchd's job and never started here.
 */
export async function autostartConfiguredChannels(
  dependencies: Partial<ChannelsHandlerDependencies> = {},
): Promise<string[]> {
  const vault = dependencies.vault ?? (() => getInProcessPlugins().vault);
  const entries = listChannelCatalog().filter((e) => e.descriptor.supportsBackground);
  return autostartChannels(
    entries.map((e) => e.descriptor.id),
    {
      services: dependencies.services ?? createCliServicePort(),
      processes: dependencies.processes ?? supervisorProcesses,
      isConfigured: async (id) => isConfigured(vault(), catalogEntry(id)),
    },
  );
}
