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

import type { ChannelEntry, ChannelRuntimeStatus } from '@moxxy/desktop-ipc-contract';
import { getInProcessPlugins, handle, IpcError } from './shared';
import { CHANNEL_CATALOG, listChannelCatalog, type ChannelCatalogEntry } from '../channel-catalog';
import { channelRuntime, startChannel, stopChannel } from '../channel-supervisor';

/** Configured == every required secret is present in the vault. */
async function isConfigured(entry: ChannelCatalogEntry): Promise<boolean> {
  const { vault } = getInProcessPlugins();
  for (const key of entry.requiredKeys) {
    if (!(await vault.has(key))) return false;
  }
  return true;
}

/** Merge the supervisor's live runtime with the vault-derived `configured`. */
function statusOf(id: string, configured: boolean): ChannelRuntimeStatus {
  const rt = channelRuntime(id);
  return {
    id,
    configured,
    running: rt.running,
    ...(rt.pid !== undefined ? { pid: rt.pid } : {}),
    ...(rt.startedAtMs !== undefined ? { startedAtMs: rt.startedAtMs } : {}),
    ...(rt.requestUrl !== undefined ? { requestUrl: rt.requestUrl } : {}),
    ...(rt.connected !== undefined ? { connected: rt.connected } : {}),
    ...(rt.error !== undefined ? { error: rt.error } : {}),
  };
}

function catalogEntry(channelId: string): ChannelCatalogEntry {
  const entry = CHANNEL_CATALOG[channelId];
  if (!entry) throw new IpcError('not-supported', `unknown channel: ${channelId}`);
  return entry;
}

export function registerChannelsHandlers(): void {
  handle('channels.list', async () => {
    const out: ChannelEntry[] = [];
    for (const entry of listChannelCatalog()) {
      out.push({
        descriptor: entry.descriptor,
        status: statusOf(entry.descriptor.id, await isConfigured(entry)),
      });
    }
    return out;
  });

  handle('channels.saveConfig', async ({ channelId, values }) => {
    const entry = catalogEntry(channelId);
    const { vault } = getInProcessPlugins();
    for (const [field, value] of Object.entries(values)) {
      const key = entry.vaultKeys[field];
      if (!key) {
        throw new IpcError('invalid-payload', `unknown config field for ${channelId}: ${field}`);
      }
      const trimmed = value.trim();
      // Skip blanks: an untouched password field comes back empty and must not
      // wipe a previously-saved secret.
      if (trimmed) await vault.set(key, trimmed);
    }
    return statusOf(channelId, await isConfigured(entry));
  });

  handle('channels.start', async ({ channelId }) => {
    const entry = catalogEntry(channelId);
    if (!(await isConfigured(entry))) {
      throw new IpcError('runner-error', `${channelId} is not configured yet`);
    }
    try {
      startChannel(channelId);
    } catch (e) {
      throw new IpcError(
        'runner-error',
        e instanceof Error ? e.message : `failed to start ${channelId}`,
      );
    }
    return statusOf(channelId, true);
  });

  handle('channels.stop', async ({ channelId }) => {
    const entry = catalogEntry(channelId);
    stopChannel(channelId);
    return statusOf(channelId, await isConfigured(entry));
  });
}
