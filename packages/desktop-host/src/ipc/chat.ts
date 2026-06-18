/**
 * Chat transcript log.
 *
 * `chat.loadSegment` / `chat.clearLog` / `chat.migrate` are thin pass-throughs
 * to the append-only NDJSON `chat-log` store, lazily imported and keyed by
 * `workspaceId`. `chat.append` is now runtime-gated: it writes the NDJSON mirror
 * ONLY against a `<v10` runner — a v10+ runner owns the authoritative log, so the
 * mirror is skipped (the double-write stops where the runner is authoritative).
 *
 * `chat.loadHistory` is the runner-authoritative read path (protocol v10): it
 * pages history straight from the workspace's connected `RemoteSession`'s log
 * instead of the NDJSON mirror, and returns `null` when the runner can't serve
 * it (no connected runner for the workspace, or a `<v10` runner) so the renderer
 * falls back to `chat.loadSegment` — no transcript ever goes blank.
 */

import type { RunnerPool } from '../runner-pool';
import { handle, resolveSupervisor } from './shared';

/**
 * Whether to still write the NDJSON mirror for a workspace, given its ATTACHED
 * runner's protocol version (`null` = no runner attached yet / version unknown).
 * A v10+ runner owns the authoritative log (the renderer reads it via
 * `chat.loadHistory`), so the mirror is redundant and skipped; against a `<v10`
 * runner — or when the version isn't known yet — we keep writing it so the
 * renderer's NDJSON fallback never loses an event.
 */
export function shouldMirrorToNdjson(runnerProtocolVersion: number | null): boolean {
  return runnerProtocolVersion === null || runnerProtocolVersion < 10;
}

export function registerChatHandlers(pool: RunnerPool): void {
  // ---- Chat transcript log (append-only NDJSON) ---------------------------

  handle('chat.append', async ({ workspaceId, events }) => {
    // Stop the NDJSON double-write once the runner is authoritative for this
    // workspace: a v10+ runner persists every committed event to its own log
    // (which the renderer now reads via chat.loadHistory), so the NDJSON mirror
    // is redundant. Keep writing it ONLY against a <v10 runner, where the
    // renderer still falls back to NDJSON for history. Gated on the ACTUAL
    // attached runner version (not the baked FLOOR) so it stays correct on an
    // existing install whose JS hot-updated ahead of its bundled CLI. When no
    // runner is attached yet (version unknown) we keep the mirror — the safe
    // default never drops an event.
    const version = resolveSupervisor(pool, workspaceId)?.remote()?.runnerProtocolVersion ?? null;
    if (!shouldMirrorToNdjson(version)) return; // v10+ runner owns the log → skip the mirror
    const { appendEvents } = await import('../chat-log');
    await appendEvents(workspaceId, events);
  });
  handle('chat.loadSegment', async ({ workspaceId, before, limit }) => {
    const { loadSegment } = await import('../chat-log');
    return loadSegment(workspaceId, before, limit);
  });
  // Runner-authoritative paged read (v10). Resolve the workspace's connected
  // RemoteSession and page its log; any miss (no supervisor / not connected /
  // older runner whose gate throws / transport error) returns null so the
  // renderer transparently falls back to the NDJSON store.
  handle('chat.loadHistory', async ({ workspaceId, before, limit }) => {
    const session = resolveSupervisor(pool, workspaceId)?.remote();
    if (!session) return null;
    try {
      return await session.loadHistory(before, limit);
    } catch {
      return null;
    }
  });
  handle('chat.clearLog', async ({ workspaceId }) => {
    const { clearLog } = await import('../chat-log');
    await clearLog(workspaceId);
  });
  handle('chat.migrate', async ({ workspaces }) => {
    const { migrate } = await import('../chat-log');
    await migrate(workspaces);
  });
}
