import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Workflow } from '@moxxy/sdk';
import { parseWorkflowYaml } from './schema.js';

/**
 * Discover workflow artifacts from disk, mirroring `discoverSkills`: scan
 * builtin → plugin → user → project in priority order, later scopes
 * overriding earlier ones by workflow name. Each `.yaml`/`.yml` file holds
 * one workflow; invalid files are skipped with a logged warning.
 */

export type WorkflowScope = 'builtin' | 'plugin' | 'user' | 'project';

export interface WorkflowLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
  info?(msg: string, meta?: Record<string, unknown>): void;
}

export interface DiscoveredWorkflow {
  readonly workflow: Workflow;
  readonly path: string;
  readonly scope: WorkflowScope;
}

export interface WorkflowLoadOptions {
  readonly projectDir?: string;
  readonly userDir?: string;
  readonly pluginDirs?: ReadonlyArray<string>;
  readonly builtinDir?: string;
  readonly logger?: WorkflowLogger;
}

/**
 * Hard ceiling on a single workflow file. The schema caps a workflow at 40
 * steps, so a real artifact is a few KB; 1 MB is far above any legitimate file.
 * Discovery runs on every `store.load()` (boot + after every create/update/
 * delete/toggle), reading each `.yaml` fully into memory before parsing — an
 * accidental or hostile multi-GB file under `~/.moxxy/workflows/` would
 * otherwise balloon the process. Over-size files are skipped (warned), not read.
 */
export const MAX_WORKFLOW_FILE_BYTES = 1024 * 1024;

export function defaultUserWorkflowsDir(): string {
  return path.join(os.homedir(), '.moxxy', 'workflows');
}

export function defaultProjectWorkflowsDir(cwd: string): string {
  return path.join(cwd, '.moxxy', 'workflows');
}

export async function discoverWorkflows(
  opts: WorkflowLoadOptions = {},
): Promise<ReadonlyArray<DiscoveredWorkflow>> {
  const sources: Array<{ dir: string; scope: WorkflowScope }> = [];
  if (opts.builtinDir) sources.push({ dir: opts.builtinDir, scope: 'builtin' });
  for (const dir of opts.pluginDirs ?? []) sources.push({ dir, scope: 'plugin' });
  sources.push({ dir: opts.userDir ?? defaultUserWorkflowsDir(), scope: 'user' });
  if (opts.projectDir) sources.push({ dir: opts.projectDir, scope: 'project' });

  const byName = new Map<string, DiscoveredWorkflow>();
  for (const source of sources) {
    for (const found of await loadDir(source.dir, source.scope, opts.logger)) {
      byName.set(found.workflow.name, found);
    }
  }
  return [...byName.values()];
}

async function loadDir(
  dir: string,
  scope: WorkflowScope,
  logger?: WorkflowLogger,
): Promise<ReadonlyArray<DiscoveredWorkflow>> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DiscoveredWorkflow[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      out.push(...(await loadDir(path.join(dir, entry.name), scope, logger)));
      continue;
    }
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    // Bound the read: stat before slurping the whole file into memory so a
    // pathological/hostile multi-GB `.yaml` is skipped, not loaded. A workflow
    // is at most 40 steps (schema cap), i.e. a few KB — anything past 1 MB is
    // not a real artifact.
    try {
      const st = await fs.stat(full);
      if (st.size > MAX_WORKFLOW_FILE_BYTES) {
        logger?.warn?.('workflow: file too large, skipping', {
          path: full,
          size: st.size,
          max: MAX_WORKFLOW_FILE_BYTES,
        });
        continue;
      }
    } catch {
      // stat failed (vanished between readdir and stat) — fall through to the
      // readFile catch below, which skips it the same way.
    }
    let raw: string;
    try {
      raw = await fs.readFile(full, 'utf8');
    } catch (err) {
      // A file unlinked between readdir and readFile (concurrent `/workflows
      // rm`, or an atomic write's .tmp window) must not abort discovery of
      // every other workflow — skip it like an unparseable file.
      logger?.warn?.('workflow: unreadable file, skipping', {
        path: full,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const result = parseWorkflowYaml(raw);
    if (!result.ok || !result.workflow) {
      logger?.warn?.('workflow: invalid file, skipping', { path: full, errors: result.errors });
      continue;
    }
    out.push({ workflow: result.workflow, path: full, scope });
  }
  return out;
}
