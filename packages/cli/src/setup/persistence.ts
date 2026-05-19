import { SessionPersistence, type Session } from '@moxxy/core';
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
 */
export function attachSessionPersistence(
  session: Session,
  cwd: string,
  disabled: boolean | undefined,
): SessionPersistence | null {
  if (disabled) return null;

  const persistence = new SessionPersistence({
    sessionId: session.id,
    cwd,
    providerName: session.providers.getActiveName() ?? undefined,
    modelId: (() => {
      try {
        return session.providers.getActive().models[0]?.id;
      } catch {
        return undefined;
      }
    })(),
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
