import { createContext, useMemo, type ReactNode } from 'react';
import { api } from '@moxxy/client-core';

/**
 * Reads back the bytes of an attachment a transcript event arrived without
 * (`omittedBytes`): the runner keeps large payloads out of what it sends the
 * window and serves them in bounded slices instead. Null outside a transcript.
 */
export type AttachmentReader = (seq: number, index: number) => Promise<string>;

export const AttachmentReaderContext = createContext<AttachmentReader | null>(null);

/** Whole attachments kept per window, so scrolling a thumbnail back into view does not read it again. */
const CACHE_SIZE = 24;
const cache = new Map<string, Promise<string>>();

async function readWhole(workspaceId: string, seq: number, index: number): Promise<string> {
  let content = '';
  for (;;) {
    const chunk = await api().invoke('chat.readAttachment', { workspaceId, seq, index, offset: content.length });
    if (!chunk) throw new Error(`attachment ${seq}:${index} is not readable`);
    content += chunk.data;
    if (content.length >= chunk.total || chunk.data.length === 0) return content;
  }
}

function cachedRead(workspaceId: string, seq: number, index: number): Promise<string> {
  const key = `${workspaceId}\u0000${seq}\u0000${index}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const read = readWhole(workspaceId, seq, index);
  read.catch(() => cache.delete(key));
  cache.set(key, read);
  const oldest = cache.keys().next();
  if (cache.size > CACHE_SIZE && !oldest.done) cache.delete(oldest.value);
  return read;
}

export function AttachmentReaderProvider({
  workspaceId,
  children,
}: {
  readonly workspaceId?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const reader = useMemo<AttachmentReader | null>(
    () => (workspaceId ? (seq, index) => cachedRead(workspaceId, seq, index) : null),
    [workspaceId],
  );
  return <AttachmentReaderContext.Provider value={reader}>{children}</AttachmentReaderContext.Provider>;
}
