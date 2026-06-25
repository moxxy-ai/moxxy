import type { Session } from '@moxxy/core';
import type { MoxxyConfig, PluginCategoryKey } from '@moxxy/config';
import { categoryDefault } from './resolve-plugins-tree.js';

type WarnLogger = { warn(msg: string, meta?: Record<string, unknown>): void };

/** The minimal active-def surface the apply loop drives. */
interface ActiveLike {
  has(name: string): boolean;
  setActive(name: string): unknown;
  getActiveName(): string | null;
}

/** A registry that can designate an already-registered def as its protected floor. */
interface FloorLike {
  has(name: string): boolean;
  markFloor(name: string): void;
}

/**
 * The built-in default contribution each ActiveDef registry should treat as its
 * protected floor when that contribution is provided by a kernel *plugin*
 * (rather than core-seeded). Called after plugin registration so the named def
 * exists; a swap-target's later removal then reverts here instead of going null.
 */
const BUILTIN_FLOORS: ReadonlyArray<{ registry: (s: Session) => FloorLike | undefined; name: string }> =
  [
    { registry: (s) => s.compactors, name: 'summarize' },
    { registry: (s) => s.cacheStrategies, name: 'stable-prefix' },
    { registry: (s) => s.workflowExecutors, name: 'dag' },
  ];

/** Kinds that must always have an active def for the app to work (assert at boot). */
const NON_NULLABLE_KINDS: ReadonlyArray<{ key: string; registry: (s: Session) => ActiveLike | undefined }> =
  [
    { key: 'mode', registry: (s) => s.modes },
    { key: 'compactor', registry: (s) => s.compactors },
    { key: 'cacheStrategy', registry: (s) => s.cacheStrategies },
    { key: 'viewRenderer', registry: (s) => s.viewRenderers },
    { key: 'tunnelProvider', registry: (s) => s.tunnelProviders },
    { key: 'eventStore', registry: (s) => s.eventStores },
  ];

/**
 * Designate the kernel-plugin-contributed defaults as protected floors. Run
 * after `registerPlugins` (so the def is registered) and before the apply loop.
 */
export function markBuiltinFloors(session: Session): void {
  for (const { registry, name } of BUILTIN_FLOORS) {
    const reg = registry(session);
    if (reg?.has(name)) reg.markFloor(name);
  }
}

/**
 * Guard that every non-nullable slot has an active def after wiring. This
 * should never fire in a real boot (the kernel packages provide each floor);
 * it catches a broken build/seed before the user hits a half-initialized app.
 */
export function assertCriticalFloors(session: Session): void {
  const missing: string[] = [];
  for (const { key, registry } of NON_NULLABLE_KINDS) {
    const reg = registry(session);
    if (!reg || reg.getActiveName() == null) missing.push(key);
  }
  if (missing.length > 0) {
    throw new Error(
      `Critical floor missing for: ${missing.join(', ')} — a core default failed to seed. ` +
        'This is a build/packaging error; the kernel packages must always be present.',
    );
  }
}

interface KindBinding {
  readonly key: PluginCategoryKey;
  readonly registry: (s: Session) => ActiveLike | undefined;
}

/**
 * The single table that maps a manifest category to its session registry, so
 * applying defaults is one loop instead of a bespoke `setActive` per kind.
 *
 * Not in this table (handled by their own bespoke paths):
 *  - `provider`  — credential fallback walk (`activateProvider`)
 *  - `embedder`  — rich options + lazy bundled-def registration (`selectEmbedder`)
 *  - `isolator`  — consumed as the security plugin's default, not a setActive
 *  - `transcriber`/`synthesizer` — nullable backends, plugin-managed
 *  - `channel`   — no single active to apply at boot
 */
const ACTIVE_DEF_KINDS: ReadonlyArray<KindBinding> = [
  { key: 'mode', registry: (s) => s.modes },
  { key: 'compactor', registry: (s) => s.compactors },
  { key: 'cacheStrategy', registry: (s) => s.cacheStrategies },
  { key: 'workflowExecutor', registry: (s) => s.workflowExecutors },
  { key: 'viewRenderer', registry: (s) => s.viewRenderers },
  { key: 'tunnelProvider', registry: (s) => s.tunnelProviders },
  { key: 'eventStore', registry: (s) => s.eventStores },
];

/**
 * Apply the manifest's per-category defaults onto the session registries. For
 * each active-def kind, read `plugins.<category>.default` (or the built-in
 * default) and `setActive` it — but only when it's registered. A default that
 * names an uninstalled/removed plugin is a warn-and-skip: the registry keeps
 * its protected floor active rather than throwing at boot or going null.
 *
 * `provider`, `embedder`, and `isolator` are applied by their bespoke callers
 * (this runs alongside them, after plugin registration).
 */
export function applyPluginsTree(session: Session, config: MoxxyConfig, logger: WarnLogger): void {
  for (const { key, registry } of ACTIVE_DEF_KINDS) {
    const reg = registry(session);
    if (!reg) continue;

    // An *explicit* config default that's missing is a warning (likely a typo
    // or an uninstalled plugin the user named); a *built-in* default whose
    // providing plugin simply isn't installed is a silent skip.
    let name = config.plugins?.[key]?.default;
    let explicit = name !== undefined;
    // Caching is on by default (stable-prefix is the floor). `caching: false`
    // selects the no-op strategy regardless of the configured cacheStrategy.
    if (key === 'cacheStrategy' && config.context?.caching === false) {
      name = 'none';
      explicit = true;
    }
    if (name === undefined) name = categoryDefault(config, key);
    if (!name) continue;

    if (reg.has(name)) {
      try {
        reg.setActive(name);
      } catch (err) {
        logger.warn(`failed to activate ${key} '${name}'; keeping the protected default`, {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (explicit) {
      logger.warn(`configured ${key} '${name}' is not registered; keeping the protected default`, {
        active: reg.getActiveName(),
      });
    }
  }
}
