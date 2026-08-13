import * as path from 'node:path';
import type { MoxxyConfig } from './schema.js';

/**
 * The SYSTEM configuration scope: settings an operator installs on a machine
 * that a user cannot override.
 *
 * Before this there was no layer above the user's own config, so an
 * organisation could not state "security.enabled is true and you may not turn
 * it off". Precedence also ran the wrong way for a managed host: a repo-local
 * `moxxy.config.ts` beat the user's own settings, and nothing beat either.
 *
 * Resolution order (first hit wins):
 *   1. `$MOXXY_SYSTEM_CONFIG`: an explicit path, for tests and for hosts whose
 *      configuration management puts it somewhere else.
 *   2. `/etc/moxxy/config.yaml` (POSIX) or `%PROGRAMDATA%\moxxy\config.yaml`
 *      (Windows), the conventional location for machine-wide settings.
 *
 * YAML ONLY, deliberately. An executable system config would run as whoever
 * starts moxxy, so a file that is writable by a non-admin (a mis-set
 * `/etc/moxxy`) would become a straightforward privilege-escalation path. Data
 * cannot do that.
 */
export function systemConfigCandidates(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
): ReadonlyArray<string> {
  const explicit = (env.MOXXY_SYSTEM_CONFIG ?? '').trim();
  if (explicit.length > 0) return [explicit];
  if (platform === 'win32') {
    const base = env.PROGRAMDATA ?? env.ProgramData;
    if (!base) return [];
    return [
      path.join(base, 'moxxy', 'config.yaml'),
      path.join(base, 'moxxy', 'config.yml'),
    ];
  }
  return ['/etc/moxxy/config.yaml', '/etc/moxxy/config.yml'];
}

/**
 * Dot-path into a config object, e.g. `security.enabled`. Returns undefined for
 * a path that does not resolve, without throwing on a missing intermediate.
 */
function getPath(obj: unknown, segments: ReadonlyArray<string>): unknown {
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Whether a dot-path is present as an own property chain. */
function hasPath(obj: unknown, segments: ReadonlyArray<string>): boolean {
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return true;
}

/** Return a copy without one dot-path, pruning objects that become empty. */
function withoutPath(
  obj: Readonly<Record<string, unknown>>,
  segments: ReadonlyArray<string>,
): Record<string, unknown> {
  const [head, ...rest] = segments;
  if (head === undefined) return { ...obj };
  return Object.fromEntries(
    Object.entries(obj).flatMap(([key, value]) => {
      if (key !== head) return [[key, value]];
      if (rest.length === 0) return [];
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [[key, value]];
      }
      const child = withoutPath(value as Readonly<Record<string, unknown>>, rest);
      return Object.keys(child).length === 0 ? [] : [[key, child]];
    }),
  );
}

export interface LockedOverride {
  /** The dot-path a lower layer tried to set. */
  readonly key: string;
  /** Which layer attempted it. */
  readonly scope: string;
}

/**
 * Strip every locked dot-path from a lower-precedence layer, returning the
 * pruned copy plus what was removed.
 *
 * Stripping BEFORE the merge rather than re-asserting the system value after it
 * is what makes the guarantee hold for nested objects: a later
 * `mergeConfigs` pass deep-merges key by key, so re-asserting only the locked
 * leaf would still let a user layer contribute siblings under the same parent
 * that the operator meant to pin whole.
 *
 * Attempts are reported rather than silently dropped, so an operator can see a
 * managed setting being fought and a user can see why their edit did nothing.
 */
export function stripLockedKeys(
  config: MoxxyConfig,
  locked: ReadonlyArray<string>,
  scope: string,
): { readonly config: MoxxyConfig; readonly overrides: ReadonlyArray<LockedOverride> } {
  if (locked.length === 0) return { config, overrides: [] };
  let clone = structuredClone(config) as Record<string, unknown>;
  const overrides: LockedOverride[] = [];
  for (const key of locked) {
    const segments = key.split('.').filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    if (!hasPath(clone, segments)) continue;
    overrides.push({ key, scope });
    clone = withoutPath(clone, segments);
  }
  return { config: clone as MoxxyConfig, overrides };
}

/** The locked dot-paths declared by a system config, if any. */
export function lockedKeysOf(config: MoxxyConfig | undefined): ReadonlyArray<string> {
  const value = getPath(config, ['locked']);
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}
