import { readSessionIndex, type Session } from '@moxxy/core';
import type { CredentialResolver } from './activate-provider.js';
import { RETIRED_PROVIDER, RETIRED_PROVIDER_REPLACEMENT, RETIRED_PROVIDER_NOTICE, RETIRED_PROVIDER_NO_CODEX } from './retired-provider.js';

type Logger = {
  warn(msg: string, meta?: Record<string, unknown>): void;
};

export async function applySessionHeaderPreferences(
  session: Session,
  sessionId: string | undefined,
  credentialResolver: CredentialResolver,
  logger: Logger,
): Promise<void> {
  if (!sessionId) return;

  let meta = null as Awaited<ReturnType<typeof readSessionIndex>>[number] | null;
  try {
    meta = (await readSessionIndex()).find((entry) => entry.id === sessionId) ?? null;
  } catch (err) {
    logger.warn('failed to load sticky session metadata', {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!meta) return;

  if (meta.provider === RETIRED_PROVIDER) {
    try {
      const cfg = await credentialResolver(RETIRED_PROVIDER_REPLACEMENT);
      session.providers.setActive(RETIRED_PROVIDER_REPLACEMENT, cfg);
      logger.warn(RETIRED_PROVIDER_NOTICE);
    } catch {
      logger.warn(RETIRED_PROVIDER_NO_CODEX);
    }
    // Private backend model ids are not Codex CLI model ids. Start with the
    // replacement connection's own default instead of replaying the old one.
    session.lastResolvedModel = null;
    session.lastResolvedProvider = null;
    return;
  }

  if (meta.provider && session.providers.list().some((p) => p.name === meta.provider)) {
    try {
      if (session.providers.getActiveName() !== meta.provider) {
        const cfg = await credentialResolver(meta.provider);
        session.providers.setActive(meta.provider, cfg);
      }
    } catch (err) {
      logger.warn('failed to restore sticky session provider', {
        sessionId,
        providerName: meta.provider,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Only a conversation something happened in has a model it last ran on; an
  // empty one starts by the usual rule (chosen default, else the light starter).
  if (meta.model && meta.eventCount > 0) {
    session.lastResolvedModel = meta.model;
    session.lastResolvedProvider = meta.provider ?? null;
  }
}
