import { SessionPersistence, type Session, type SessionSource } from '@moxxy/core';
import { definePlugin } from '@moxxy/sdk';

/**
 * Wire session persistence to the live event log. Returns null when the
 * caller opted out via `disableSessionPersistence`.
 *
 * Persistence is attached LAST — after seeded events are in place and
 * after onInit hooks have run, so we only record the user's actual
 * turn activity (not boot artifacts). The detach is registered as an
 * onShutdown hook so we get a final index update with the real
 * lastActivity timestamp when Session.close() fires.
 *
 * The runner writes the session's single metadata file (`<id>.json`), stamped
 * with its originating channel, and every surface (TUI/desktop/mobile) derives
 * its workspace list from those files — there is no separate registry copy to
 * keep in sync.
 */
export function attachSessionPersistence(
  session: Session,
  cwd: string,
  disabled: boolean | undefined,
): SessionPersistence | null {
  if (disabled) return null;

  const providerName = session.providers.getActiveName() ?? undefined;
  const modelId = (() => {
    try {
      return session.providers.getActive().models[0]?.id;
    } catch {
      return undefined;
    }
  })();
  const persistence = new SessionPersistence({
    sessionId: session.id,
    cwd,
    providerName,
    modelId,
    source: sessionSource(),
  });
  const detach = persistence.attach(session.log);
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
  return persistence;
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
