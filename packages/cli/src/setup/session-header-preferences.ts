import { readSessionIndex, type Session } from '@moxxy/core';
import type { CredentialResolver } from './activate-provider.js';

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

  if (meta.model) {
    session.lastResolvedModel = meta.model;
  }
}
