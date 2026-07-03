import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { z, createMutex, defineTool, definePlugin, type Plugin } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { findUpward, loadConfig } from './loader.js';
import { moxxyConfigSchema, type MoxxyConfig } from './schema.js';
import { setConfigValue } from './config-writer.js';

/**
 * Optional callback that the CLI (or any session host) can provide to apply
 * config changes to a live session without a restart. The applier receives the
 * full validated config snapshot AFTER the write; it should diff against its
 * own cached state and update the parts it can apply safely.
 *
 * Return a list of changed paths that were reflected at runtime, plus any
 * that need a session restart to take effect.
 */
export interface ConfigApplyResult {
  readonly applied: ReadonlyArray<string>;
  readonly pending: ReadonlyArray<string>;
}
export type ConfigApplier = (snapshot: MoxxyConfig) => Promise<ConfigApplyResult>;

const scopeSchema = z.enum(['user', 'project']);
type Scope = z.infer<typeof scopeSchema>;
// Default scope when the model omits it. Project-local is the safer
// default for read tools — touching the user-global file is usually an
// explicit operator action, not an inferred one.
const scopeSchemaOptional = scopeSchema.optional().default('project');

const USER_YAML = (): string => moxxyPath('config.yaml');

// The editor tools only read/write YAML configs (`doc.setIn` then re-serialize),
// so the project-scope walk deliberately matches ONLY the YAML names — never the
// .ts/.js configs `loadConfig` also honors, which these tools can't safely edit.
// The upward-walk traversal itself is shared with loader.ts (findUpward) so the
// depth bound can't drift; only this name list differs, by design.
const PROJECT_YAML_NAMES = ['moxxy.config.yaml', 'moxxy.config.yml'] as const;

async function findScopePath(scope: Scope, cwd: string): Promise<string | null> {
  if (scope === 'user') {
    const yaml = USER_YAML();
    try {
      await fs.access(yaml);
      return yaml;
    } catch {
      return null;
    }
  }
  // Project scope: walk upward looking for moxxy.config.yaml first, .yml second.
  return findUpward(cwd, PROJECT_YAML_NAMES);
}

function scopeDefaultPath(scope: Scope, cwd: string): string {
  return scope === 'user' ? USER_YAML() : path.join(cwd, 'moxxy.config.yaml');
}

/**
 * True when a resolved project-scope target lives ABOVE cwd. The upward walk
 * (findScopePath → findUpward) can resolve a config file in an ancestor dir, so
 * a write/init may silently mutate a parent monorepo's or home-dir config. We
 * surface this in the tool result so the operator can see the edit left the
 * project root rather than discovering it after the fact. User scope is always
 * the explicit ~/.moxxy path, so it never counts as an ancestor write.
 */
function isOutsideCwd(target: string, cwd: string): boolean {
  const rel = path.relative(path.resolve(cwd), path.resolve(target));
  return rel.startsWith('..') || path.isAbsolute(rel);
}

async function readDoc(filePath: string): Promise<{ doc: import('yaml').Document.Parsed; text: string }> {
  const text = await fs.readFile(filePath, 'utf8').catch(() => '');
  const yamlMod = (await import('yaml')) as typeof import('yaml');
  const doc = yamlMod.parseDocument(text);
  return { doc, text };
}

function parseDotPath(p: string): Array<string | number> {
  if (!p) return [];
  return p.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

// True only when `cursor` is a plain object or array that has `seg` as an OWN
// (not inherited) property. Keeps config_get's dot-path traversal inside the
// parsed config instead of letting it climb the prototype chain or index into
// scalar values.
function isIndexableOwn(cursor: unknown, seg: string | number): boolean {
  if (cursor === null || typeof cursor !== 'object') return false;
  if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') return false;
  return Object.prototype.hasOwnProperty.call(cursor, seg);
}

function parseValue(raw: string): unknown {
  // Try JSON first (allows arrays, numbers, booleans, strings, objects).
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Capability fs globs shared by the tools below. The project-scope config can
// resolve in an ANCESTOR directory (findUpward's bounded walk), so these
// anchor on the well-known basenames rather than `$cwd` — the cap matcher
// tests them against absolute paths. The editor tools only ever touch YAML;
// reload/validate go through loadConfig, which also honors executable
// configs (config.ts/js in ~/.moxxy, moxxy.config.ts/js in the project).
const YAML_CONFIG_GLOBS = [
  '~/.moxxy/config.yaml',
  '/**/moxxy.config.yaml',
  '/**/moxxy.config.yml',
] as const;
const LOADER_CONFIG_GLOBS = ['~/.moxxy/config.*', '/**/moxxy.config.*'] as const;

export function buildConfigPlugin(
  opts: { cwd: string; applier?: ConfigApplier } = { cwd: process.cwd() },
): Plugin {
  const cwd = opts.cwd;
  const applier = opts.applier;

  // Per-instance mutex serializing the read-modify-write of the config file.
  // writeFileAtomic prevents torn writes but not lost updates: two concurrent
  // config_set calls (the model can fire tools in parallel) would each apply
  // their edit on top of the same stale doc, and the last atomic rename would
  // clobber the other. Mirrors provider-admin/store.ts.
  const writeMutex = createMutex();

  return definePlugin({
    name: '@moxxy/plugin-config',
    version: '0.0.0',
    tools: [
      defineTool({
        name: 'config_path',
        description:
          'Return the resolved file path for the moxxy config at a given scope ' +
          '(defaults to "project" — the moxxy.config.yaml in the current dir). ' +
          'Returns null if no file exists yet.',
        inputSchema: z.object({ scope: scopeSchemaOptional }),
        isolation: {
          capabilities: {
            fs: { read: [...YAML_CONFIG_GLOBS] },
            net: { mode: 'none' },
            timeMs: 10_000,
          },
        },
        handler: async ({ scope }) => {
          const found = await findScopePath(scope, cwd);
          return { scope, path: found, defaultPath: scopeDefaultPath(scope, cwd) };
        },
      }),
      defineTool({
        name: 'config_show',
        description:
          'Return the raw text of the moxxy config at the given scope (defaults to "project"). ' +
          'Useful when the agent needs to inspect or edit it.',
        inputSchema: z.object({ scope: scopeSchemaOptional }),
        isolation: {
          capabilities: {
            fs: { read: [...YAML_CONFIG_GLOBS] },
            net: { mode: 'none' },
            timeMs: 10_000,
          },
        },
        handler: async ({ scope }) => {
          const found = await findScopePath(scope, cwd);
          if (!found) return { scope, path: null, text: '' };
          const text = await fs.readFile(found, 'utf8');
          return { scope, path: found, text };
        },
      }),
      defineTool({
        name: 'config_get',
        description:
          'Read a single value from the config by dot-path (e.g. "provider.model"). Returns the parsed JSON value.',
        inputSchema: z.object({ scope: scopeSchemaOptional, path: z.string().min(1) }),
        // `$cwd/*`: the `path` INPUT is a dot-path ("provider.model"), not a
        // file, but the cap checker's key heuristic treats it as one and
        // resolves it against cwd — cover that single-segment resolution so
        // legitimate reads aren't denied. The real fs surface is the globs.
        isolation: {
          capabilities: {
            fs: { read: [...YAML_CONFIG_GLOBS, '$cwd/*'] },
            net: { mode: 'none' },
            timeMs: 10_000,
          },
        },
        handler: async ({ scope, path: dotPath }) => {
          const found = await findScopePath(scope, cwd);
          if (!found) return null;
          const yamlMod = (await import('yaml')) as typeof import('yaml');
          const text = await fs.readFile(found, 'utf8');
          const parsed = yamlMod.parse(text) ?? {};
          const segs = parseDotPath(dotPath);
          let cursor: unknown = parsed;
          for (const seg of segs) {
            // Only descend into a plain object or array, and only into an OWN
            // property — otherwise a path like `constructor.prototype.toString`
            // would walk the prototype chain and leak built-ins, and indexing a
            // string value would return characters by number.
            if (!isIndexableOwn(cursor, seg)) return null;
            cursor = (cursor as Record<string | number, unknown>)[seg];
          }
          return cursor ?? null;
        },
      }),
      defineTool({
        name: 'config_set',
        description:
          'Set a value at a dot-path in the moxxy config. Creates the file if missing. Value is JSON-parsed (so pass `"sonnet"`, `42`, `["a","b"]`, etc).',
        inputSchema: z.object({
          scope: scopeSchema,
          path: z.string().min(1),
          value: z.string(),
        }),
        permission: { action: 'prompt' },
        // Comment-preserving read-modify-write of the YAML config. `$cwd/*`
        // covers the dot-path `path` input, which the cap checker's key
        // heuristic resolves against cwd (see config_get). The live applier
        // is a host-owned closure; its runtime effects are the host's.
        isolation: {
          capabilities: {
            fs: { read: [...YAML_CONFIG_GLOBS, '$cwd/*'], write: [...YAML_CONFIG_GLOBS] },
            net: { mode: 'none' },
            timeMs: 30_000,
          },
        },
        handler: async ({ scope, path: dotPath, value }) => {
          // ONE write implementation for every surface: the shared
          // schema-validated, comment-preserving, mutex-serialized writer
          // (config-writer.ts) — the TUI /settings panel writes through the
          // same function, so tool and UI writes can't interleave or drift.
          const written = await setConfigValue({
            scope,
            cwd,
            path: dotPath,
            value: parseValue(value),
          });

          // If a runtime applier is wired, try to reflect the change live.
          let runtime: ConfigApplyResult = { applied: [], pending: [] };
          if (applier) {
            try {
              runtime = await applier(written.config);
            } catch (err) {
              runtime = {
                applied: [],
                pending: [`reload-failed: ${err instanceof Error ? err.message : String(err)}`],
              };
            }
          }

          return {
            path: written.path,
            outsideCwd: scope === 'project' && isOutsideCwd(written.path, cwd),
            runtime,
          };
        },
      }),
      defineTool({
        name: 'config_reload',
        description:
          'Re-read the merged config from disk and apply the safe subset of changes (mode, compactor, plugin enable/disable) to the active session. Anything outside that subset is reported in `pending` and requires a restart.',
        inputSchema: z.object({}),
        // loadConfig may execute a .ts/.js config via jiti, whose compile
        // cache lands under node_modules/.cache. The applier is a host-owned
        // closure; its runtime effects (plugin load/unload) are the host's.
        isolation: {
          capabilities: {
            fs: {
              read: [...LOADER_CONFIG_GLOBS],
              write: ['/**/node_modules/.cache/**', '/tmp/**'],
            },
            net: { mode: 'none' },
            timeMs: 30_000,
          },
        },
        handler: async () => {
          if (!applier) {
            return { applied: [], pending: ['(no runtime applier configured)'] };
          }
          const { config: fresh } = await loadConfig({ cwd });
          return await applier(fresh);
        },
      }),
      defineTool({
        name: 'config_init',
        description:
          'Create a starter moxxy config file at the given scope (yaml format), if one does not already exist.',
        inputSchema: z.object({ scope: scopeSchema }),
        permission: { action: 'prompt' },
        isolation: {
          capabilities: {
            fs: {
              read: [...YAML_CONFIG_GLOBS],
              write: ['~/.moxxy/config.yaml', '$cwd/moxxy.config.yaml'],
            },
            net: { mode: 'none' },
            timeMs: 30_000,
          },
        },
        handler: async ({ scope }) =>
          writeMutex.run(async () => {
            const existing = await findScopePath(scope, cwd);
            if (existing) {
              return {
                path: existing,
                created: false,
                outsideCwd: scope === 'project' && isOutsideCwd(existing, cwd),
              };
            }
            const target = scopeDefaultPath(scope, cwd);
            await fs.mkdir(path.dirname(target), { recursive: true });
            const template = `# moxxy config (${scope} scope)
# Documentation: https://docs.moxxy.ai
plugins:
  provider:
    default: anthropic
    items:
      anthropic:
        model: claude-sonnet-4-6
  mode:
    default: default
`;
            await writeFileAtomic(target, template);
            return {
              path: target,
              created: true,
              outsideCwd: scope === 'project' && isOutsideCwd(target, cwd),
            };
          }),
      }),
      defineTool({
        name: 'config_validate',
        description:
          'Re-run schema validation on the merged config (user + project) without applying any changes. Returns ok or the list of issues.',
        inputSchema: z.object({}),
        // Same surface as config_reload: loadConfig may execute a .ts/.js
        // config via jiti (compile cache under node_modules/.cache).
        isolation: {
          capabilities: {
            fs: {
              read: [...LOADER_CONFIG_GLOBS],
              write: ['/**/node_modules/.cache/**', '/tmp/**'],
            },
            net: { mode: 'none' },
            timeMs: 30_000,
          },
        },
        handler: async () => {
          try {
            await loadConfig({ cwd });
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      }),
    ],
  });
}
