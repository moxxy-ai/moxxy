import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createMutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { findUpward } from './loader.js';
import { moxxyConfigSchema, type MoxxyConfig } from './schema.js';

/**
 * The ONE schema-validated, comment-preserving dot-path config writer. Both
 * the model-facing `config_set` tool (plugin.ts) and UI surfaces (the TUI's
 * /settings panel) write through here, sharing a single mutex, so concurrent
 * writers can't interleave and no surface can persist a structurally-invalid
 * config.
 */
export type ConfigScope = 'user' | 'project';

const USER_YAML = (): string => moxxyPath('config.yaml');

// YAML names only — the writer round-trips documents with `setIn`, which it
// can't do for the .ts/.js configs loadConfig also honors.
const PROJECT_YAML_NAMES = ['moxxy.config.yaml', 'moxxy.config.yml'] as const;

/** Serializes every config write in this process (tool + UI surfaces). */
export const configWriteMutex = createMutex();

export async function findScopePath(scope: ConfigScope, cwd: string): Promise<string | null> {
  if (scope === 'user') {
    const yaml = USER_YAML();
    try {
      await fs.access(yaml);
      return yaml;
    } catch {
      return null;
    }
  }
  return findUpward(cwd, PROJECT_YAML_NAMES);
}

export function scopeDefaultPath(scope: ConfigScope, cwd: string): string {
  return scope === 'user' ? USER_YAML() : path.join(cwd, 'moxxy.config.yaml');
}

export function parseDotPath(p: string): Array<string | number> {
  return p.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

export interface SetConfigValueOptions {
  readonly scope: ConfigScope;
  readonly cwd: string;
  /** Dot path into the config (e.g. `context.reasoning`, `tui.hints`). */
  readonly path: string;
  /** The ALREADY-PARSED value to set (callers own string→value parsing). */
  readonly value: unknown;
}

export interface SetConfigValueResult {
  /** The file that was written. */
  readonly path: string;
  /** The full validated config snapshot after the write. */
  readonly config: MoxxyConfig;
}

export async function setConfigValue(opts: SetConfigValueOptions): Promise<SetConfigValueResult> {
  return configWriteMutex.run(async () => {
    const target = (await findScopePath(opts.scope, opts.cwd)) ?? scopeDefaultPath(opts.scope, opts.cwd);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const yamlMod = (await import('yaml')) as typeof import('yaml');
    let text = '';
    try {
      text = await fs.readFile(target, 'utf8');
    } catch {
      /* new file */
    }
    const doc = yamlMod.parseDocument(text);
    doc.setIn(parseDotPath(opts.path), opts.value);
    const candidate = String(doc);
    const parsed = yamlMod.parse(candidate);
    const validated = moxxyConfigSchema.safeParse(parsed ?? {});
    if (!validated.success) {
      throw new Error(
        `config write to '${opts.path}' would produce an invalid config:\n` +
          JSON.stringify(validated.error.issues, null, 2),
      );
    }
    await writeFileAtomic(target, candidate);
    return { path: target, config: validated.data };
  });
}
