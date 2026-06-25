import type { EventStoreSession, Session } from '@moxxy/core';

/**
 * Cleanly tear down a one-shot CLI session so the process can exit promptly
 * WITHOUT dropping the last event.
 *
 * One-shot commands (`moxxy -p`, `moxxy schedule run`, `doctor`, `login`,
 * `init`) boot a full session and then return — but a bare `return` leaves the
 * event loop holding open handles (webhook listeners, the scheduler poller, the
 * persistence debounce timer) and the persistence append queue's LAST write may
 * still be in flight. Without an explicit teardown the process either hangs on
 * those handles or exits before the final event reaches disk.
 *
 * Order matters and is the whole point of this helper:
 *   1. `persistence.flush()` — collapse the debounced index write so the meta
 *      sidecar reflects the final `lastActivity`/`eventCount` on disk.
 *   2. `persistence.settleWrites()` — drain the append queue so the LAST
 *      appended event line is on disk (appends are enqueued fire-and-forget).
 *   3. `session.close()` — fire `onShutdown` hooks (which DETACH persistence,
 *      flush the vault, etc.) and stop the init-time daemons/listeners.
 *
 * The persistence drain runs BEFORE `close()` so the last event is durable even
 * though `close()`'s shutdown hook detaches the persistence listener.
 *
 * Idempotent and safe in a `finally`: `Session.close()` is a no-op after the
 * first call, `flush()`/`settleWrites()` on an already-drained queue resolve
 * immediately, and the persistence handle is optional (null when persistence
 * was disabled). It never throws — a teardown failure must never mask the
 * command's own result or exit code.
 */
export async function closeSession(
  session: Session,
  persistence?: EventStoreSession | null,
): Promise<void> {
  // Drain persistence FIRST so the last event + final index row are on disk
  // before the shutdown hook detaches the listener. Best-effort: a flush
  // failure must not block the session close that stops the daemons.
  if (persistence) {
    await persistence.flush().catch(() => undefined);
    await persistence.settleWrites().catch(() => undefined);
  }
  await session.close('cli-exit').catch(() => undefined);
}
