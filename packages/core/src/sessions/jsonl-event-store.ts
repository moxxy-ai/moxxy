import type { EventStoreDef, EventStoreScope, EventStoreSession } from '@moxxy/sdk';
import { SessionPersistence, readEventPage, restoreEvents } from './persistence.js';

/**
 * The built-in EventStore: per-session JSONL (`~/.moxxy/sessions/<id>.jsonl`) +
 * a `.json` meta sidecar. A thin adapter over the battle-tested
 * {@link SessionPersistence} (write) and `restoreEvents`/`readEventPage` (read)
 * — zero behaviour change, just expressed behind the {@link EventStoreDef}
 * contract. Core seeds this as the protected floor: a plugin can register an
 * alternative store, but it never auto-activates (the user opts in by name via
 * `plugins.eventStore.default`).
 *
 * `SessionPersistence` already exposes the full {@link EventStoreSession}
 * surface (attach/flush/settleWrites/updateHeader/degraded), so `open` returns
 * one directly.
 */
export const jsonlEventStore: EventStoreDef = {
  name: 'jsonl',
  open(scope: EventStoreScope): EventStoreSession {
    return new SessionPersistence({
      sessionId: scope.sessionId,
      cwd: scope.cwd,
      ...(scope.dir ? { dir: scope.dir } : {}),
      ...(scope.providerName ? { providerName: scope.providerName } : {}),
      ...(scope.modelId ? { modelId: scope.modelId } : {}),
      ...(scope.source ? { source: scope.source } : {}),
    });
  },
  restore: (sessionId, dir) => restoreEvents(sessionId, dir),
  readPage: (sessionId, opts, dir) => readEventPage(sessionId, opts, dir),
};
