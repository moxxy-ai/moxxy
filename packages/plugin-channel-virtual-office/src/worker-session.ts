/**
 * Spawns additional in-process worker sessions for the virtual office.
 *
 * Core has no public "boot a fully-wired sibling session" factory (the CLI's
 * `setupSessionWithConfig` lives in `@moxxy/cli`, which depends on every
 * channel package — importing it here would be a workspace cycle, and the
 * desktop's process-per-session supervisor is the wrong weight for a "Spawn
 * agent" button). So the office clones: a fresh `Session` whose registries
 * mirror the primary's at spawn time.
 *
 * Known, accepted snapshot semantics (also logged in TECH_DEBT.md with an
 * upstream `sessionFactory` proposal):
 *  - the worker's PluginHost/dispatcher are empty, so plugin `onEvent` /
 *    turn-lifecycle hooks do NOT fire for worker turns;
 *  - registry copies are snapshots — workers don't see plugin hot-reloads;
 *  - tool handlers that close over the PRIMARY session (memory store,
 *    scheduler, present_view) still work but act on shared/global state.
 *
 * What IS shared on purpose: the live provider instance (no re-auth), the
 * `PermissionEngine` (an "always allow" persists once and applies to every
 * worker), and the vault-backed secret resolver.
 */

import { Session, SessionPersistence } from '@moxxy/core';
import type { Logger } from '@moxxy/core';
import type { SessionLike } from '@moxxy/sdk';

export interface SpawnWorkerOptions {
  readonly cwd: string;
  readonly logger?: Logger;
  /** Vault-backed secret resolver (`ctx.getSecret` for worker tool calls). */
  readonly secretResolver?: (name: string) => Promise<string | null>;
}

/** Capability probe: a local core `Session` (registries present) vs. a
 *  `RemoteSession` proxy. The office must host N sessions in-process, so it
 *  refuses to start against a remote. */
export function isLocalSession(session: SessionLike): session is Session {
  const s = session as Partial<Session>;
  return (
    typeof s.providers?.list === 'function' &&
    typeof s.pluginHost === 'object' &&
    s.pluginHost !== null
  );
}

/** Register `items` into a registry, skipping ones already present (the
 *  Session constructor seeds defaults — e.g. the view renderer and the
 *  localhost tunnel — which would otherwise throw on duplicate). */
function copyInto<T>(items: ReadonlyArray<T>, register: (item: T) => void): void {
  for (const item of items) {
    try {
      register(item);
    } catch (err) {
      if (err instanceof Error && /already registered/i.test(err.message)) continue;
      throw err;
    }
  }
}

/**
 * Create a new worker `Session` mirroring the primary's registries and
 * sharing its credentialed provider instance + permission policy.
 */
export function spawnWorkerSession(primary: Session, opts: SpawnWorkerOptions): Session {
  const worker = new Session({
    cwd: opts.cwd,
    ...(opts.logger ? { logger: opts.logger } : {}),
    permissionEngine: primary.permissions,
    ...(opts.secretResolver ? { secretResolver: opts.secretResolver } : {}),
  });

  // Providers: share the primary's already-credentialed ACTIVE instance so a
  // worker turn never re-runs auth; other defs lazily create their own client
  // if ever activated. `setActive` finds the cached instance and does not call
  // `createClient` for it.
  const activeProvider = primary.providers.getActiveName();
  for (const def of primary.providers.list()) {
    worker.providers.register(def, def.name === activeProvider ? primary.providers.getActive() : undefined);
  }
  if (activeProvider) worker.providers.setActive(activeProvider);

  copyInto(primary.modes.list(), (m) => worker.modes.register(m));
  try {
    worker.modes.setActive(primary.modes.getActive().name);
  } catch {
    // No active mode on the primary (pre-boot edge) — the first registered
    // mode auto-activated on the worker; that's the same default.
  }

  copyInto(primary.tools.list(), (t) => worker.tools.register(t));
  copyInto(primary.commands.list(), (c) => worker.commands.register(c));
  copyInto(primary.skills.list(), (s) => worker.skills.register(s));
  copyInto(primary.agents.list(), (a) => worker.agents.register(a));
  copyInto(primary.compactors.list(), (c) => worker.compactors.register(c));
  const activeCompactor = primary.compactors.getActive();
  if (activeCompactor) worker.compactors.setActive(activeCompactor.name);
  copyInto(primary.cacheStrategies.list(), (s) => worker.cacheStrategies.register(s));
  const activeCacheStrategy = primary.cacheStrategies.getActive();
  if (activeCacheStrategy) worker.cacheStrategies.setActive(activeCacheStrategy.name);
  copyInto(primary.viewRenderers.list(), (v) => worker.viewRenderers.register(v));
  copyInto(primary.tunnelProviders.list(), (t) => worker.tunnelProviders.register(t));
  copyInto(primary.transcribers.list(), (t) => worker.transcribers.register(t));
  copyInto(primary.synthesizers.list(), (s) => worker.synthesizers.register(s));
  copyInto(primary.embedders.list(), (e) => worker.embedders.register(e));
  copyInto(primary.isolators.list(), (i) => worker.isolators.register(i));
  copyInto(primary.workflowExecutors.list(), (w) => worker.workflowExecutors.register(w));

  // Plain runtime fields, by reference: `readyProviders` is the live
  // credentials-resolved set (sharing keeps worker `getInfo()` truthful),
  // and elision/lazy-tools settings follow the primary's config.
  worker.elisionSettings = primary.elisionSettings;
  worker.lazyTools = primary.lazyTools;
  if (primary.readyProviders) worker.readyProviders = primary.readyProviders;
  if (primary.credentialResolver) worker.credentialResolver = primary.credentialResolver;
  // Deliberately NOT copied: `workflows` / `mcpAdmin` / `pluginsAdmin` — those
  // views close over the primary's plugin host; worker commands that need them
  // degrade with their own "not supported" paths.

  return worker;
}

/** Attach per-worker transcript persistence (`~/.moxxy/sessions/<id>.jsonl`),
 *  mirroring the CLI's setup. Returns the detach function — call it before
 *  closing the worker so the index records a final lastActivity. */
export function attachWorkerPersistence(worker: Session): () => void {
  const persistence = new SessionPersistence({
    sessionId: worker.id,
    cwd: worker.cwd,
    providerName: worker.providers.getActiveName() ?? undefined,
    modelId: (() => {
      try {
        return worker.providers.getActive().models[0]?.id;
      } catch {
        return undefined;
      }
    })(),
  });
  return persistence.attach(worker.log);
}
