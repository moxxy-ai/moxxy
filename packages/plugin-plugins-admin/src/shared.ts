/**
 * Helpers shared by the plugins-admin install/uninstall and enable/disable
 * tools (formerly duplicated verbatim across `install.ts` and `toggle.ts`).
 */

/** A bare or scoped npm package name with no version/spec suffix. */
export const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Names of registered contributions, grouped by kind. */
export interface PluginSnapshot {
  readonly tools: ReadonlyArray<string>;
  readonly agents: ReadonlyArray<string>;
  readonly providers: ReadonlyArray<string>;
  readonly modes: ReadonlyArray<string>;
  readonly compactors: ReadonlyArray<string>;
  readonly channels: ReadonlyArray<string>;
}

/**
 * Guard an install/uninstall spec before it is handed to `npm` as a CLI
 * argument. `installPluginPackage` accepts more than a bare name — `name@version`,
 * `github:`/`git+`/`https://`/`ssh://` git specs, and local paths — so it cannot
 * validate against {@link NPM_NAME_RE}. What it MUST stop is a spec that npm would
 * parse as an OPTION instead of a package: none of the legitimate spec shapes start
 * with `-`, so a leading dash is an argument-injection attempt (e.g. `-g`,
 * `--prefix=/`, `--registry=…`). `spawn` runs npm without a shell, so this is not a
 * shell-injection risk — but an injected flag could still change install behavior.
 *
 * Throws on an empty or flag-like spec; returns the trimmed spec otherwise.
 */
export function assertSafeNpmSpec(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new Error('plugin spec must be a non-empty package name, git spec, or path');
  }
  if (trimmed.startsWith('-')) {
    throw new Error(
      `refusing plugin spec "${spec}": leading "-" would be parsed by npm as an option, not a package`,
    );
  }
  return trimmed;
}

/** Contributions present in `after` but not `before`, grouped by kind. */
export function diffSnapshot(
  before: PluginSnapshot,
  after: PluginSnapshot,
): Record<string, ReadonlyArray<string>> {
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const key of ['tools', 'agents', 'providers', 'modes', 'compactors', 'channels'] as const) {
    const b = new Set(before[key]);
    const added = after[key].filter((n) => !b.has(n));
    if (added.length > 0) out[key] = added;
  }
  return out;
}
