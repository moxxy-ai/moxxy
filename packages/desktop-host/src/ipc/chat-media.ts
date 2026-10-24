/**
 * The chat media library: the photos, files and links of one chat, read from
 * its whole log through the index {@link ChatMediaStore} keeps. Every command
 * names its chat the way the history commands do, and is refused for a chat
 * that is not this desktop's.
 */

import { ATTACHMENT_READ_CHUNK_CHARS } from '@moxxy/sdk';
import type { ChatMediaStore } from '../chat-media/store';
import type { DeskStore } from '../desks';
import { isReadableSession } from './chat';
import { openLocalPath, type FilesHandlerDependencies } from './files';
import { handle, IpcError } from './shared';
import type { EventBus } from '../event-bus';

/** The registry announces deletions from every surface through the same bus. */
export function watchChatMediaCleanup(store: ChatMediaStore, bus: EventBus): () => void {
  return bus.addSink({
    broadcast(channel) {
      if (channel === 'desks.changed') void store.sweep().catch(() => undefined);
    },
  });
}

export function registerChatMediaHandlers(
  desks: DeskStore,
  store: ChatMediaStore,
  files: FilesHandlerDependencies,
): void {
  handle('chat.media', async ({ workspaceId }) => {
    if (!(await isReadableSession(workspaceId, desks))) return null;
    const entries = await store.library(workspaceId);
    return { items: entries.map((entry) => entry.item) };
  });

  handle('chat.mediaThumbnail', async ({ workspaceId, id }) => {
    if (!(await isReadableSession(workspaceId, desks))) return null;
    return store.thumbnail(workspaceId, id);
  });

  handle('chat.readMediaImage', async ({ workspaceId, id, offset }) => {
    if (!(await isReadableSession(workspaceId, desks))) return null;
    const image = await store.image(workspaceId, id);
    if (!image) return null;
    return {
      mediaType: image.mediaType,
      data: image.base64.slice(offset, offset + ATTACHMENT_READ_CHUNK_CHARS),
      total: image.base64.length,
    };
  });

  handle('chat.openMediaFile', async ({ workspaceId, id }) => {
    if (!(await isReadableSession(workspaceId, desks))) throw new IpcError('invalid-payload', 'unknown chat');
    const target = await store.file(workspaceId, id);
    if (!target) throw new IpcError('invalid-payload', 'not a file of this chat');
    return openLocalPath(target, files);
  });
}
