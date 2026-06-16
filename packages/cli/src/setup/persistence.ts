import { SessionPersistence, type Session, type SessionMeta } from '@moxxy/core';
import { definePlugin } from '@moxxy/sdk';
import { WorkspaceRegistry, type WorkspaceSessionSource } from '@moxxy/workspace-registry';

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
  });
  const detach = persistence.attach(session.log);
  const detachRegistry = attachWorkspaceRegistrySync(session, cwd, providerName, modelId);
  session.pluginHost.registerStatic(
    definePlugin({
      name: '@moxxy/session-persistence-handle',
      version: '0.0.0',
      hooks: {
        onShutdown: async () => {
          detach();
          detachRegistry();
        },
      },
    }),
  );
  return persistence;
}

function attachWorkspaceRegistrySync(
  session: Session,
  cwd: string,
  providerName: string | undefined,
  modelId: string | undefined,
): () => void {
  const registry = new WorkspaceRegistry();
  const source = sessionSource();
  const now = new Date().toISOString();
  let meta: SessionMeta = {
    id: String(session.id),
    cwd,
    startedAt: now,
    lastActivity: now,
    eventCount: 0,
    firstPrompt: null,
    provider: providerName ?? null,
    model: modelId ?? null,
  };
  let registered = false;

  const sync = () => {
    if (!registered && !hasUserVisibleContent(meta)) return;
    registered = true;
    void registry.registerSessionFromMeta(meta, source).catch(() => undefined);
  };

  const unsubscribe = session.log.subscribe((event) => {
    meta = {
      ...meta,
      eventCount: meta.eventCount + 1,
      lastActivity: new Date().toISOString(),
      firstPrompt:
        meta.firstPrompt ??
        (event.type === 'user_prompt' ? event.text.slice(0, 80) : null),
      ...providerHeaderFromEvent(event),
    };
    sync();
  });
  const unsubscribeClear = session.log.onClear(() => {
    meta = {
      ...meta,
      eventCount: 0,
      firstPrompt: null,
      lastActivity: new Date().toISOString(),
    };
    sync();
  });

  return () => {
    unsubscribe();
    unsubscribeClear();
    sync();
  };
}

function sessionSource(): WorkspaceSessionSource {
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

function hasUserVisibleContent(meta: SessionMeta): boolean {
  return Boolean(meta.firstPrompt?.trim());
}

function providerHeaderFromEvent(event: { readonly type: string; readonly provider?: unknown; readonly model?: unknown }): {
  readonly provider?: string | null;
  readonly model?: string | null;
} {
  if (event.type !== 'provider_request' && event.type !== 'provider_response') return {};
  return {
    provider: typeof event.provider === 'string' ? event.provider : null,
    model: typeof event.model === 'string' ? event.model : null,
  };
}
