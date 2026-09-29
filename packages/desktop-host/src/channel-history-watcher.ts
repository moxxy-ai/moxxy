/**
 * Pushes "this channel's conversation changed" by watching the sessions dir for
 * the bot's sticky log (`moxxy-channel-<id>.jsonl`). The bot runs in another
 * process (desktop child or background service), so its log file is the one
 * signal shared by every run mode. Debounced: a streamed reply appends many
 * events. Best-effort — without a watch the view still loads on open.
 */

import { mkdirSync, watch, type FSWatcher } from 'node:fs';
import { defaultSessionsDir } from '@moxxy/core';

export function channelSessionId(channelId: string): string {
  return `moxxy-channel-${channelId}`;
}

export function watchChannelHistory(
  channelIds: ReadonlyArray<string>,
  onChange: (channelId: string) => void,
  opts: { readonly dir?: string; readonly debounceMs?: number } = {},
): () => void {
  const dir = opts.dir ?? defaultSessionsDir();
  const debounceMs = opts.debounceMs ?? 250;
  const byFile = new Map(channelIds.map((id) => [`${channelSessionId(id)}.jsonl`, id]));
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let watcher: FSWatcher | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    watcher = watch(dir, { persistent: false }, (_event, filename) => {
      const id = filename ? byFile.get(filename.toString()) : undefined;
      if (!id) return;
      const pending = timers.get(id);
      if (pending) clearTimeout(pending);
      const timer = setTimeout(() => {
        timers.delete(id);
        onChange(id);
      }, debounceMs);
      timer.unref?.();
      timers.set(id, timer);
    });
  } catch {
    return () => undefined;
  }
  return () => {
    for (const t of timers.values()) clearTimeout(t);
    watcher?.close();
  };
}
