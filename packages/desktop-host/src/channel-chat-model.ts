/**
 * A bot's model is one state: its `<channel>_model` vault key. The bot reads it
 * before every turn; `/model` in the messenger and Setup in the desktop write
 * it. The desktop's chat with the bot follows it here, so the header shows the
 * bot's model and a message written in the app runs with it too.
 */

import { watch } from 'node:fs';
import path from 'node:path';
import { channelSessionId } from '@moxxy/runner';
import { CHANNEL_CATALOG, listChannelCatalog } from './channel-catalog';
import { setSessionModel } from './session-models';

export interface ChannelChatModelDeps {
  readonly vault: () => { get(key: string): Promise<string | null> };
  /** Make `provider` the active provider of the chat's runner session. */
  readonly activateProvider: (workspaceId: string, provider: string) => Promise<void>;
}

const SEPARATOR = '::';

function splitChoice(raw: string | null): { provider: string; model: string } | null {
  if (!raw) return null;
  const at = raw.indexOf(SEPARATOR);
  const provider = at > 0 ? raw.slice(0, at).trim() : '';
  const model = at > 0 ? raw.slice(at + SEPARATOR.length).trim() : '';
  return provider && model ? { provider, model } : null;
}

/** The channel whose bot a chat belongs to, or null for a workspace's chat. */
export function channelOfChat(workspaceId: string): string | null {
  const entry = listChannelCatalog().find((e) => channelSessionId(e.descriptor.id) === workspaceId);
  return entry ? entry.descriptor.id : null;
}

/** Point the bot's chat at the bot's saved model (none saved = the default). */
export async function syncChannelChatModel(channelId: string, deps: ChannelChatModelDeps): Promise<void> {
  const key = CHANNEL_CATALOG[channelId]?.modelVaultKey;
  if (!key) return;
  const workspaceId = channelSessionId(channelId);
  const choice = splitChoice(await deps.vault().get(key));
  if (choice) await deps.activateProvider(workspaceId, choice.provider);
  setSessionModel(workspaceId, choice ? choice.model : null);
}

/**
 * Call `onChange` when the vault file changes — a bot's `/model` runs in its
 * own process, so this is how the desktop hears of it. Watches the directory:
 * the vault is replaced by an atomic rename, which a file watch would miss.
 */
export function watchChannelModels(vaultFile: string, onChange: () => void): () => void {
  const name = path.basename(vaultFile);
  const watcher = watch(path.dirname(vaultFile), (_event, file) => {
    if (file === null || file === name) onChange();
  });
  watcher.on('error', () => undefined);
  return () => watcher.close();
}
