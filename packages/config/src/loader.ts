import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { moxxyHome } from '@moxxy/sdk/server';
import { mergeConfigs } from './merge.js';
import { moxxyConfigSchema, type MoxxyConfig } from './schema.js';

export interface LoadConfigOptions {
  readonly cwd: string;
  readonly explicitPath?: string;
  readonly skipUser?: boolean;
}

export interface LoadedConfig {
  readonly config: MoxxyConfig;
  readonly sources: ReadonlyArray<{ scope: 'project' | 'user' | 'explicit'; path: string }>;
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
  const sources: Array<{ scope: 'project' | 'user' | 'explicit'; path: string }> = [];
  const configs: MoxxyConfig[] = [];

  if (!opts.skipUser) {
    const userPath = await findFile(moxxyHome(), USER_CONFIG_NAMES);
    if (userPath) {
      const cfg = await loadOne(userPath);
      configs.push(cfg);
      sources.push({ scope: 'user', path: userPath });
    }
  }

  if (opts.explicitPath) {
    const cfg = await loadOne(opts.explicitPath);
    configs.push(cfg);
    sources.push({ scope: 'explicit', path: opts.explicitPath });
  } else {
    const projectPath = await findUpward(opts.cwd, CONFIG_NAMES);
    if (projectPath) {
      warnIfAncestorExecutableConfig(projectPath, opts.cwd);
      const cfg = await loadOne(projectPath);
      configs.push(cfg);
      sources.push({ scope: 'project', path: projectPath });
    }
  }

  return { config: mergeConfigs(...configs), sources };
}

const EXECUTABLE_CONFIG_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function isUnderDir(filePath: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(filePath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The project-config upward walk resolves and then EXECUTES the first matching
 * config above cwd. An ancestor (e.g. a shared home/temp parent or an untrusted
 * outer repo) can therefore plant a config whose code runs with full process
 * privileges. We keep the documented upward-walk behavior but surface the exact
 * absolute path on stderr before running an ancestor *executable* config, so the
 * operator can see what is about to execute. Non-executable YAML and at/under-cwd
 * configs are silent (no new trust boundary widened).
 */
function warnIfAncestorExecutableConfig(filePath: string, cwd: string): void {
  if (!EXECUTABLE_CONFIG_EXTS.has(path.extname(filePath))) return;
  if (isUnderDir(filePath, cwd)) return;
  console.warn(
    `[moxxy] executing project config from an ancestor directory: ${path.resolve(filePath)}`,
  );
}

async function loadOne(filePath: string): Promise<MoxxyConfig> {
  const ext = path.extname(filePath);
  let raw: unknown;

  if (ext === '.yaml' || ext === '.yml') {
    const yamlText = await fs.readFile(filePath, 'utf8');
    const yamlMod = (await import('yaml')) as { parse: (text: string) => unknown };
    raw = yamlMod.parse(yamlText);
    if (raw === null || raw === undefined) raw = {};
  } else {
    let mod: unknown;
    if (ext === '.ts' || ext === '.tsx') {
      const jiti = await getJiti(path.dirname(filePath));
      if (!jiti) throw new Error(`Cannot load ${filePath}: jiti is required for .ts configs.`);
      mod = jiti(filePath);
    } else {
      mod = await importJsConfig(filePath);
    }
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
    const instance = factory(cwd, { interopDefault: true });
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

// The ESM module registry never evicts an entry once imported and offers no
// eviction API: every DISTINCT specifier is retained for the process lifetime
// along with its whole module graph. A naive `?v=${Date.now()}` cache-buster on
// every load therefore leaks one module per reload in the exact long-lived
// hosts (desktop/runner) this loader targets. Instead: import each JS config by
// its plain file URL the FIRST time (one registry entry, GC-stable), and only
// append a cache-buster when re-loading a path we've already imported — using a
// monotonic counter so same-millisecond reloads are still guaranteed unique
// (Date.now()'s 1ms resolution would otherwise return the stale cached module).
const importedJsConfigs = new Set<string>();
let importReloadCounter = 0;

async function importJsConfig(filePath: string): Promise<unknown> {
  const base = pathToFileURL(filePath).href;
  if (importedJsConfigs.has(base)) {
    return import(`${base}?v=${Date.now()}-${++importReloadCounter}`);
  }
  importedJsConfigs.add(base);
  return import(base);
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
