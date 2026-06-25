import { type EventStoreSession, type Session, type SessionSource } from '@moxxy/core';
import { definePlugin } from '@moxxy/sdk';

/**
 * Wire session persistence to the live event log via the session's ACTIVE
 * EventStore (the protected JSONL floor by default; a plugin store when the
 * user has swapped `plugins.eventStore.default`). Returns null when the caller
 * opted out via `disableSessionPersistence`.
 *
 * Attached LAST — after seeded events are in place and after onInit hooks have
 * run, so we only record the user's actual turn activity (not boot artifacts).
 * The detach is registered as an onShutdown hook so we get a final index update
 * with the real lastActivity timestamp when Session.close() fires.
 *
 * The store writes the session's single metadata record, stamped with its
 * originating channel, and every surface (TUI/desktop/mobile) derives its
 * workspace list from those — there is no separate registry copy to keep in sync.
 */
export function attachSessionPersistence(
  session: Session,
  cwd: string,
  disabled: boolean | undefined,
): EventStoreSession | null {
  if (disabled) return null;

  const providerName = session.providers.getActiveName() ?? undefined;
  const modelId = (() => {
    try {
      return session.providers.getActive().models[0]?.id;
    } catch {
      return undefined;
    }
  })();
  // The floor guarantees an active store; guard defensively rather than throw.
  const store = session.eventStores.getActive();
  if (!store) return null;
  const handle = store.open({
    sessionId: session.id,
    cwd,
    providerName,
    modelId,
    source: sessionSource(),
  });
  const detach = handle.attach(session.log);
  session.pluginHost.registerStatic(
    definePlugin({
      name: '@moxxy/session-persistence-handle',
      version: '0.0.0',
      hooks: {
        onShutdown: async () => {
          detach();
        },
      },
    }),
  );
  return handle;
}

/** Originating channel of this runner, for the session file's `source`. The
 *  spawning surface sets `MOXXY_SESSION_SOURCE`; absent that, a sticky session
 *  id implies a desktop-spawned runner, otherwise the interactive TUI. */
function sessionSource(): SessionSource {
  const explicit = process.env['MOXXY_SESSION_SOURCE'];
  if (
    explicit === 'desktop' ||
    explicit === 'tui' ||
    explicit === 'mobile' ||
    explicit === 'cli'
  ) {
    return explicit;
  }
  return process.env['MOXXY_SESSION_ID'] ? 'desktop' : 'tui';
}
