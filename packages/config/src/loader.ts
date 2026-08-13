import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { moxxyHome } from '@moxxy/sdk/server';
import { mergeConfigs } from './merge.js';
import { moxxyConfigSchema, type MoxxyConfig } from './schema.js';
import { hashConfigFile, isConfigTrusted, trustConfig } from './config-trust.js';
import {
  lockedKeysOf,
  stripLockedKeys,
  systemConfigCandidates,
  type LockedOverride,
} from './system-scope.js';

/** Layers `loadConfig` reads, highest-authority first. Distinct from
 *  config-writer's `ConfigScope`: the system layer is operator-managed and is
 *  never a write target. */
export type ConfigLoadScope = 'system' | 'project' | 'user' | 'explicit';

/**
 * Asked to approve executing a project config whose content has not been
 * trusted before. Returning false (or omitting the callback) skips the file.
 *
 * Only wired on interactive surfaces. A headless run has nobody to ask, so it
 * refuses rather than executing unreviewed code, and the operator pre-approves
 * with `moxxy config trust`.
 */
export type ConfigTrustPrompt = (info: {
  readonly path: string;
  readonly sha256: string;
}) => Promise<boolean>;

export interface LoadConfigOptions {
  readonly cwd: string;
  readonly explicitPath?: string;
  readonly skipUser?: boolean;
  /** Skip the machine-wide scope (tests, and `--no-system-config`). */
  readonly skipSystem?: boolean;
  /** Consent hook for an untrusted executable config. */
  readonly trustPrompt?: ConfigTrustPrompt;
  /** Where refusals and locked-key overrides are surfaced. Defaults to stderr. */
  readonly warn?: (message: string) => void;
}

export interface LoadedConfig {
  readonly config: MoxxyConfig;
  readonly sources: ReadonlyArray<{ scope: ConfigLoadScope; path: string }>;
  /** Locked dot-paths a lower layer tried to set and had stripped. */
  readonly lockedOverrides: ReadonlyArray<LockedOverride>;
  /** Executable configs that were found but NOT executed, and why. */
  readonly skipped: ReadonlyArray<{ readonly path: string; readonly reason: string }>;
}

const CONFIG_NAMES = [
  'moxxy.config.yaml',
  'moxxy.config.yml',
  'moxxy.config.ts',
  'moxxy.config.js',
  'moxxy.config.mjs',
  'moxxy.config.cjs',
];
const USER_CONFIG_NAMES = [
  'config.yaml',
  'config.yml',
  'config.ts',
  'config.js',
  'config.mjs',
  'config.cjs',
];
/** Cap upward filesystem traversal when searching for a project config.
 *  Shared with the config plugin's scope-resolution walk so the bound can't
 *  drift between load time (here) and edit time (plugin.ts). */
export const MAX_CONFIG_SEARCH_DEPTH = 12;

export async function loadConfig(opts: LoadConfigOptions): Promise<LoadedConfig> {
  const sources: Array<{ scope: ConfigLoadScope; path: string }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const warn = opts.warn ?? ((m: string) => process.stderr.write(`[moxxy] ${m}\n`));

  // The system scope loads FIRST and is the only layer allowed to lock keys.
  // Everything below it is pruned against that list before merging.
  let system: MoxxyConfig | undefined;
  let systemPath: string | undefined;
  if (!opts.skipSystem) {
    systemPath = await findFirstExisting(systemConfigCandidates());
    if (systemPath) {
      system = await loadOne(systemPath);
      sources.push({ scope: 'system', path: systemPath });
    }
  }
  const locked = lockedKeysOf(system);
  // A system config can forbid executing project configs outright, which is
  // what a managed workstation wants: only data, never code.
  const allowExecutable = system?.config?.allowExecutable ?? true;

  const lower: Array<{ scope: ConfigLoadScope; path: string; config: MoxxyConfig }> = [];

  if (!opts.skipUser) {
    const userPath = await findFile(moxxyHome(), USER_CONFIG_NAMES);
    if (userPath) {
      const loaded = await loadGuarded(userPath, { allowExecutable, opts, warn, skipped });
      if (loaded) lower.push({ scope: 'user', path: userPath, config: loaded });
    }
  }

  if (opts.explicitPath) {
    const loaded = await loadGuarded(opts.explicitPath, { allowExecutable, opts, warn, skipped });
    if (loaded) lower.push({ scope: 'explicit', path: opts.explicitPath, config: loaded });
  } else {
    const projectPath = await findUpward(opts.cwd, CONFIG_NAMES);
    if (projectPath) {
      const loaded = await loadGuarded(projectPath, { allowExecutable, opts, warn, skipped });
      if (loaded) lower.push({ scope: 'project', path: projectPath, config: loaded });
    }
  }

  const lockedOverrides: LockedOverride[] = [];
  const configs: MoxxyConfig[] = system ? [system] : [];
  for (const layer of lower) {
    const pruned = stripLockedKeys(layer.config, locked, layer.scope);
    lockedOverrides.push(...pruned.overrides);
    configs.push(pruned.config);
    sources.push({ scope: layer.scope, path: layer.path });
  }
  for (const override of lockedOverrides) {
    warn(
      `ignoring ${override.scope} config override of "${override.key}": ` +
        `locked by the system config${systemPath ? ` (${systemPath})` : ''}`,
    );
  }

  return { config: mergeConfigs(...configs), sources, lockedOverrides, skipped };
}

interface GuardContext {
  readonly allowExecutable: boolean;
  readonly opts: LoadConfigOptions;
  readonly warn: (message: string) => void;
  readonly skipped: Array<{ path: string; reason: string }>;
}

/**
 * Load a config, gating EXECUTABLE ones behind policy and consent.
 *
 * The loader resolves and then runs `.ts`/`.js` configs with full process
 * privileges, before the permission engine, the vault, or any isolator exists.
 * Because the project search also walks upward, `git clone` + `cd` + `moxxy`
 * used to execute a stranger's code with no signal at all. Consent is keyed to
 * file CONTENT, so editing a trusted config asks again: what was approved is
 * the file somebody read.
 *
 * Returns undefined when the file was not executed, in which case the caller
 * simply proceeds with the remaining layers. Refusing a layer is always safer
 * than running unreviewed code, so every failure path here skips.
 */
async function loadGuarded(
  filePath: string,
  ctx: GuardContext,
): Promise<MoxxyConfig | undefined> {
  if (!EXECUTABLE_CONFIG_EXTS.has(path.extname(filePath))) return await loadOne(filePath);

  const resolved = path.resolve(filePath);
  if (!ctx.allowExecutable) {
    const reason = 'executable configs are disabled by the system config';
    ctx.warn(`skipping ${resolved}: ${reason}`);
    ctx.skipped.push({ path: resolved, reason });
    return undefined;
  }
  if (await isConfigTrusted(resolved)) return await loadOne(filePath);

  const sha256 = await hashConfigFile(resolved);
  if (!sha256) {
    const reason = 'cannot read the file to establish trust';
    ctx.warn(`skipping ${resolved}: ${reason}`);
    ctx.skipped.push({ path: resolved, reason });
    return undefined;
  }
  if (ctx.opts.trustPrompt && (await ctx.opts.trustPrompt({ path: resolved, sha256 }))) {
    await trustConfig(resolved);
    return await loadOne(filePath);
  }
  // No prompt available means a headless run, which has nobody to ask. Refuse
  // rather than execute unreviewed code; `moxxy config trust` pre-approves it.
  const reason = ctx.opts.trustPrompt
    ? 'not approved'
    : 'untrusted executable config and no interactive prompt available; ' +
      `approve it with \`moxxy config trust ${resolved}\``;
  ctx.warn(`skipping ${resolved}: ${reason}`);
  ctx.skipped.push({ path: resolved, reason });
  return undefined;
}

async function findFirstExisting(candidates: ReadonlyArray<string>): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* try the next */
    }
  }
  return undefined;
}

// Superseded the ancestor-only stderr warning that used to live here: consent
// now gates EVERY executable config, at or above cwd, so a narrower warning for
// the ancestor case would only add noise to a path that already asks.
const EXECUTABLE_CONFIG_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

async function loadOne(filePath: string): Promise<MoxxyConfig> {
  const ext = path.extname(filePath);
  let raw: unknown;

  if (ext === '.yaml' || ext === '.yml') {
    const yamlText = await fs.readFile(filePath, 'utf8');
    const yamlMod = (await import('yaml')) as { parse: (text: string) => unknown };
    raw = yamlMod.parse(yamlText);
    if (raw === null || raw === undefined) raw = {};
  } else {
    const jiti = await getJiti(path.dirname(filePath));
    if (!jiti) throw new Error(`Cannot load executable config ${filePath}: jiti is required.`);
    const mod = jiti(filePath);
    raw = extractDefault(mod);
    if (!raw) {
      throw new Error(`Config file ${filePath} must default-export the result of defineConfig().`);
    }
  }

  const parsed = moxxyConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid moxxy config at ${filePath}:\n` + JSON.stringify(parsed.error.issues, null, 2),
    );
  }
  return parsed.data;
}

// Key the cache by cwd: a jiti instance binds its module-resolution /
// interopDefault base to the dir it was created with, so a single shared
// instance would resolve a SECOND project's `.ts` config relative imports
// against the FIRST project's dir. Long-lived hosts (desktop/runner) load
// configs for multiple workspaces in one process, so each cwd needs its own.
//
// Each entry carries its own module-resolution + compiled-module store, so an
// unbounded map would grow one jiti runtime per workspace dir forever. Cap it
// with a small LRU (re-insert on hit, drop the oldest on overflow) so a
// long-running host that opens many projects keeps only a bounded working set.
const MAX_CACHED_JITI = 16;
const cachedJiti = new Map<string, (id: string) => unknown>();

type JitiFactory = (cwd: string, opts?: unknown) => (id: string) => unknown;

async function getJiti(cwd: string): Promise<((id: string) => unknown) | null> {
  const existing = cachedJiti.get(cwd);
  if (existing) {
    // Mark as most-recently-used.
    cachedJiti.delete(cwd);
    cachedJiti.set(cwd, existing);
    return existing;
  }
  try {
    const mod = await import('jiti');
    const factory =
      (mod as { createJiti?: JitiFactory; default?: JitiFactory }).createJiti ??
      (mod as { default?: JitiFactory }).default;
    if (!factory) return null;
    // Configs are intentionally reloadable in long-lived desktop/runner
    // processes. Keep the compiled-source cache, but never retain evaluated
    // modules: a file edit must be visible on the next load.
    const instance = factory(cwd, { interopDefault: false, moduleCache: false });
    cachedJiti.set(cwd, instance);
    while (cachedJiti.size > MAX_CACHED_JITI) {
      const oldest = cachedJiti.keys().next().value;
      if (oldest === undefined) break;
      cachedJiti.delete(oldest);
    }
    return instance;
  } catch {
    return null;
  }
}

function extractDefault(mod: unknown): unknown {
  if (!mod) return undefined;
  if (typeof mod !== 'object') return undefined;
  const m = mod as Record<string, unknown>;
  if (m.default && typeof m.default === 'object') return m.default;
  return undefined;
}

/**
 * Walk upward from `startDir` (bounded by {@link MAX_CONFIG_SEARCH_DEPTH})
 * returning the first directory that holds one of `names`. The `names` list is
 * a deliberate parameter: `loadConfig` searches every config extension while the
 * config plugin's editor searches only the YAML names it can safely mutate — so
 * the shared traversal invariant lives here, the divergent name set stays with
 * the caller. Returns the full path, or null if none found within the bound.
 */
export async function findUpward(
  startDir: string,
  names: ReadonlyArray<string>,
): Promise<string | null> {
  let cursor = path.resolve(startDir);
  for (let i = 0; i < MAX_CONFIG_SEARCH_DEPTH; i++) {
    const found = await findFile(cursor, names);
    if (found) return found;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

async function findFile(dir: string, names: ReadonlyArray<string>): Promise<string | null> {
  for (const name of names) {
    const candidate = path.join(dir, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}
