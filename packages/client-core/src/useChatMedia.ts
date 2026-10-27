import { useEffect, useState } from 'react';
import type { ChatMediaItem } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';

/** Events after which the library can hold something new. */
const CHANGING_EVENTS = new Set(['user_prompt', 'assistant_message', 'tool_result']);

export interface ChatMediaState {
  /** Newest first; empty until the chat's library is read. */
  readonly items: ReadonlyArray<ChatMediaItem>;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * One chat's photos, files and links, read from its whole log by the host. It
 * is read again when the chat records something that can add to it (a prompt,
 * an answer, a tool's result, a finished turn, a cleared chat), never on a
 * timer; a burst of those while a read runs makes one more read after it.
 */
export function useChatMedia(workspaceId: string | null): ChatMediaState {
  const [snapshot, setSnapshot] = useState<{
    readonly workspaceId: string | null;
    readonly items: ReadonlyArray<ChatMediaItem>;
    readonly error: string | null;
    readonly loaded: boolean;
  }>({ workspaceId: null, items: [], error: null, loaded: false });
  useEffect(() => {
    if (!workspaceId) return undefined;
    let live = true;
    let inFlight = false;
    let again = false;
    const read = async (): Promise<void> => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      try {
        do {
          again = false;
          try {
            const library = await api().invoke('chat.media', { workspaceId });
            if (!live) return;
            setSnapshot({ workspaceId, items: library?.items ?? [], error: null, loaded: true });
          } catch (e) {
            if (!live) return;
            setSnapshot((prev) => ({
              workspaceId,
              items: prev.workspaceId === workspaceId ? prev.items : [],
              error: toErrorMessage(e),
              loaded: true,
            }));
          }
        } while (again && live);
      } finally {
        inFlight = false;
      }
    };
    const mine = (payload: { workspaceId: string }): boolean => payload.workspaceId === workspaceId;
    const offs = [
      api().subscribe('runner.event', (payload) => {
        if (mine(payload) && CHANGING_EVENTS.has(payload.event.type)) void read();
      }),
      api().subscribe('runner.turn.complete', (payload) => {
        if (mine(payload)) void read();
      }),
      api().subscribe('chat.cleared', (payload) => {
        if (!mine(payload)) return;
        __clearChatMediaThumbnails();
        setSnapshot({ workspaceId, items: [], error: null, loaded: false });
        void read();
      }),
    ];
    void read();
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, [workspaceId]);

  const ours = snapshot.workspaceId === workspaceId;
  return {
    items: ours ? snapshot.items : [],
    loading: Boolean(workspaceId) && !(ours && snapshot.loaded),
    error: ours ? snapshot.error : null,
  };
}

/** Thumbnails already read, by chat and item: scrolling back draws them at once. */
const thumbnails = new Map<string, string>();
let thumbnailGeneration = 0;
/** Enough for a long scroll through one library; the oldest go first. */
const MAX_THUMBNAILS = 400;

/** Test seam: forget the thumbnails read so far. */
export function __clearChatMediaThumbnails(): void {
  thumbnails.clear();
  thumbnailGeneration += 1;
}

/**
 * A library image's thumbnail as a data URL, asked for only once `shown` (the
 * tile scrolled into view) and kept for the next time. `null` until then, and
 * when the host has none.
 */
export function useChatMediaThumbnail(workspaceId: string | null, id: string, shown: boolean): string | null {
  const generation = thumbnailGeneration;
  const key = `${generation}\u0000${workspaceId ?? ''}\u0000${id}`;
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly src: string } | null>(null);
  const kept = thumbnails.get(key) ?? null;

  useEffect(() => {
    if (!shown) {
      setLoaded(null);
      return undefined;
    }
    if (!workspaceId || !shown || thumbnails.has(key)) return undefined;
    let live = true;
    api()
      .invoke('chat.mediaThumbnail', { workspaceId, id })
      .then(
        (image) => {
          if (!image || generation !== thumbnailGeneration) return;
          const src = `data:${image.mediaType};base64,${image.base64}`;
          thumbnails.set(key, src);
          while (thumbnails.size > MAX_THUMBNAILS) {
            const oldest = thumbnails.keys().next().value;
            if (oldest === undefined) break;
            thumbnails.delete(oldest);
          }
          if (live) setLoaded({ key, src });
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [workspaceId, id, key, shown, generation]);

  return shown ? (kept ?? (loaded?.key === key ? loaded.src : null)) : null;
}

/** A library image whole, read slice by slice; null when the chat no longer has it. */
export async function readChatMediaImage(
  workspaceId: string,
  id: string,
): Promise<{ readonly mediaType: string; readonly base64: string } | null> {
  let base64 = '';
  for (;;) {
    const chunk = await api().invoke('chat.readMediaImage', { workspaceId, id, offset: base64.length });
    if (!chunk) return null;
    base64 += chunk.data;
    if (chunk.data.length === 0 || base64.length >= chunk.total)
      return { mediaType: chunk.mediaType, base64 };
  }
}
