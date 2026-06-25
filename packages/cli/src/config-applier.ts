import { PluginRequirementError, readPackageMoxxyRequirements, type Session } from '@moxxy/core';
import type { MoxxyRequirement, Plugin } from '@moxxy/sdk';
import type { ConfigApplier, ConfigApplyResult, MoxxyConfig } from '@moxxy/config';

export interface BuiltinPluginEntry {
  readonly name: string;
  readonly plugin: Plugin;
}

interface BuiltinPluginRecord {
  readonly plugin: Plugin;
  /** Resolved lazily on first toggle from `<name>/package.json#moxxy.requirements`. */
  requirements?: ReadonlyArray<MoxxyRequirement>;
  requirementsLoaded: boolean;
}

/**
 * Build a ConfigApplier closed over a live Session. The applier diffs the new
 * config snapshot against its own cached "last applied" config and reflects
 * changes onto the session immediately where it can.
 *
 * Live (applied):
 *   mode, compactor, plugins[X].enabled (toggle register/unload).
 * Pending (next boot):
 *   provider.* (key rotation needs vault unlock + setActive)
 *   embeddings.* (memory plugin is built once)
 *   channels.*  (applies on next `moxxy <channel>` invocation)
 *   skills.*    (restart to rediscover)
 *   permissions.* (restart to reload policy)
 *
 * For plugin hot-toggling, the applier needs the original `{name, plugin}`
 * map that setupSession used so it can re-register a previously-disabled
 * plugin. Pass it in via the third arg.
 */
export function buildSessionConfigApplier(
  session: Session,
  initial: MoxxyConfig,
  builtins: ReadonlyArray<BuiltinPluginEntry> = [],
  /**
   * Live disabled-package set shared with the PluginHost's `isDisabled`
   * predicate. Kept in sync as toggles are applied so a later
   * `pluginHost.reload()` honors the new state (esp. for discovered plugins,
   * which the host can re-discover but must not resurrect when disabled).
   */
  disabledPackages?: Set<string>,
): ConfigApplier {
  let last: MoxxyConfig = initial;
  const builtinsByName = new Map<string, BuiltinPluginRecord>(
    builtins.map((b) => [b.name, { plugin: b.plugin, requirementsLoaded: false }] as const),
  );

  return async (next): Promise<ConfigApplyResult> => {
    const applied: string[] = [];
    const pending: string[] = [];

    const nextMode = next.plugins?.mode?.default;
    if (nextMode !== last.plugins?.mode?.default) {
      try {
        if (nextMode) session.modes.setActive(nextMode);
        applied.push('mode');
      } catch (err) {
        pending.push(`mode (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    const nextCompactor = next.plugins?.compactor?.default;
    if (nextCompactor !== last.plugins?.compactor?.default) {
      try {
        if (nextCompactor) session.compactors.setActive(nextCompactor);
        applied.push('compactor');
      } catch (err) {
        pending.push(`compactor (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    const nextCacheStrategy = next.plugins?.cacheStrategy?.default;
    if (
      next.context?.caching !== last.context?.caching ||
      nextCacheStrategy !== last.plugins?.cacheStrategy?.default
    ) {
      try {
        if (next.context?.caching === false) session.cacheStrategies.setActive('none');
        else session.cacheStrategies.setActive(nextCacheStrategy ?? 'stable-prefix');
        applied.push('cacheStrategy');
      } catch (err) {
        pending.push(`cacheStrategy (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    // elision/reasoning are object-shaped config values; a re-parsed config
    // yields fresh references each load, so compare structurally — otherwise we
    // reassign + report "applied" on every save even when nothing changed.
    if (!deepEqual(next.context?.elision, last.context?.elision)) {
      session.elisionSettings = next.context?.elision ?? null;
      applied.push('elision');
    }

    if (next.context?.lazyTools !== last.context?.lazyTools) {
      session.lazyTools = next.context?.lazyTools ?? false;
      applied.push('lazyTools');
    }

    if (!deepEqual(next.context?.reasoning, last.context?.reasoning)) {
      session.reasoning = next.context?.reasoning;
      applied.push('reasoning');
    }

    if (next.hookTimeoutMs !== last.hookTimeoutMs) {
      // The dispatcher reads its timeout at construction. v0: pending.
      pending.push('hookTimeoutMs (restart required)');
    }

    if (providerChanged(last, next)) {
      pending.push('provider.* (restart required)');
    }

    // Plugin enable/disable: actually apply now.
    const toggles = await applyPluginToggles(session, builtinsByName, last, next);
    for (const t of toggles.applied) applied.push(`plugins[${t.name}].enabled=${t.enabled}`);
    for (const p of toggles.pending) pending.push(p);
    // Keep the host's disabled-set in sync so a subsequent reload() won't
    // re-load a freshly-disabled discovered plugin (and vice-versa). Only
    // explicitly-mentioned names are touched, preserving boot-scope disables.
    if (disabledPackages) {
      for (const [name, settings] of Object.entries(next.plugins?.packages ?? {})) {
        if (settings?.enabled === false) disabledPackages.add(name);
        else disabledPackages.delete(name);
      }
    }

    // These are nested-record config values; `shallowEqual` would see fresh
    // per-key object references on every re-parsed config and spuriously report
    // a pending change each save (training users to ignore the restart nudge).
    // Compare structurally so we only surface pending on a real difference.
    if (!deepEqual(last.plugins?.embedder, next.plugins?.embedder)) {
      pending.push('embedder.* (restart required to rebuild memory embedder)');
    }
    if (!deepEqual(last.channels, next.channels)) {
      pending.push('channels.* (applies on next `moxxy <channel>` invocation)');
    }
    if (!deepEqual(last.skills, next.skills)) {
      pending.push('skills.* (restart to rediscover)');
    }
    if (!deepEqual(last.permissions, next.permissions)) {
      pending.push('permissions.* (restart to reload policy)');
    }

    last = next;
    return { applied, pending };
  };
}

interface PluginToggle {
  readonly name: string;
  readonly enabled: boolean;
}

interface PluginToggleResult {
  readonly applied: ReadonlyArray<PluginToggle>;
  readonly pending: ReadonlyArray<string>;
}

/**
 * Walk every plugin in the union of (builtins, old config, new config) and
 * compare the resulting effective-enabled state. Apply the deltas via the
 * plugin host. Returns the set of toggles that were actually applied (success
 * cases only).
 */
async function applyPluginToggles(
  session: Session,
  builtinsByName: Map<string, BuiltinPluginRecord>,
  last: MoxxyConfig,
  next: MoxxyConfig,
): Promise<PluginToggleResult> {
  const allNames = new Set<string>([
    ...builtinsByName.keys(),
    ...Object.keys(last.plugins?.packages ?? {}),
    ...Object.keys(next.plugins?.packages ?? {}),
  ]);
  const applied: PluginToggle[] = [];
  const pending: string[] = [];

  const loaded = new Set(session.pluginHost.list().map((p) => p.name));

  for (const name of allNames) {
    const wasEnabled = effectiveEnabled(last, name);
    const nowEnabled = effectiveEnabled(next, name);
    if (wasEnabled === nowEnabled) continue;

    if (nowEnabled) {
      // Re-register
      const record = builtinsByName.get(name);
      if (!record) continue; // can't re-register a plugin we don't have a handle for
      if (loaded.has(name)) continue; // already registered
      if (!record.requirementsLoaded) {
        const reqs = await readPackageMoxxyRequirements(name, session.cwd);
        if (reqs.length > 0) record.requirements = reqs;
        record.requirementsLoaded = true;
      }
      try {
        session.pluginHost.registerStatic(record.plugin, record.requirements ? { requirements: record.requirements } : {});
        applied.push({ name, enabled: true });
      } catch (err) {
        if (err instanceof PluginRequirementError) {
          pending.push(`plugins[${name}].enabled=true (${err.message})`);
          continue;
        }
        pending.push(`plugins[${name}].enabled=true (${err instanceof Error ? err.message : String(err)})`);
      }
    } else {
      // Unload
      if (!loaded.has(name)) continue;
      try {
        await session.pluginHost.unload(name);
        applied.push({ name, enabled: false });
      } catch (err) {
        pending.push(`plugins[${name}].enabled=false (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  return { applied, pending };
}

function effectiveEnabled(cfg: MoxxyConfig, name: string): boolean {
  const entry = cfg.plugins?.packages?.[name];
  if (!entry) return true; // default: enabled when not mentioned
  return entry.enabled !== false;
}

function providerChanged(a: MoxxyConfig, b: MoxxyConfig): boolean {
  const pa = a.plugins?.provider;
  const pb = b.plugins?.provider;
  if (pa?.default !== pb?.default) return true;
  if (!arraysEqual(pa?.fallbacks, pb?.fallbacks)) return true;
  if (!deepEqual(pa?.items, pb?.items)) return true;
  return false;
}

/**
 * Structural equality for the JSON-shaped config values (plain objects, arrays,
 * primitives, undefined/null). A re-parsed config yields fresh references for
 * every nested value, so reference identity (and a one-level `shallowEqual`)
 * always reports nested records as "changed"; this compares by value instead.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  const ak = Object.keys(ar);
  const bk = Object.keys(br);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(br, k)) return false;
    if (!deepEqual(ar[k], br[k])) return false;
  }
  return true;
}

function arraysEqual<T>(a: ReadonlyArray<T> | undefined, b: ReadonlyArray<T> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
