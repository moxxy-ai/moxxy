import * as path from 'node:path';
import { MoxxyError } from '@moxxy/sdk';

/**
 * Normalize `target` against `cwd`. Returns an absolute path. **Does not
 * sandbox** — absolute targets and `../` traversal are allowed by design,
 * because the agent often needs to touch paths outside the cwd (`~/.config`,
 * `/etc/...`). Safety against unintended access lives at the permission
 * layer (`PermissionEngine` + the resolver), which prompts the user before
 * any tool runs. Tools that genuinely need to confine to cwd should use
 * `resolveWithinCwd` instead.
 *
 * Renamed from `resolveSafe` to make the contract honest — the old name
 * implied a sandbox it never performed.
 */
export function resolvePath(cwd: string, target: string): string {
  if (path.isAbsolute(target)) return path.normalize(target);
  return path.resolve(cwd, target);
}

/**
 * Like `resolvePath` but throws if the result escapes `cwd`. Use for tools
 * that should be strictly confined (rare).
 */
export function resolveWithinCwd(cwd: string, target: string): string {
  const resolved = resolvePath(cwd, target);
  const cwdAbs = path.resolve(cwd);
  const rel = path.relative(cwdAbs, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new MoxxyError({
      code: 'TOOL_ERROR',
      message: `Path escapes cwd: ${target} (resolved to ${resolved}, outside ${cwdAbs})`,
    });
  }
  return resolved;
}

/**
 * @deprecated Use `resolvePath` (no behavior change — only honest name).
 * Kept as a thin alias so external callers still compile.
 */
export const resolveSafe = resolvePath;

/**
 * Directory names skipped during recursive traversal by the Glob and Grep
 * tools — build outputs and VCS metadata that are never useful search targets.
 * Kept in one place so the two walkers stay in sync.
 */
export const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', '.turbo']);

/**
 * Files larger than this are not slurped fully into the heap — a multi-hundred-MB
 * log, a SQLite db, or a media blob would otherwise OOM the process on a path the
 * model invokes constantly (Read/Edit/Write/Grep). Result clamping bounds the
 * OUTPUT, not the per-file working set; this bounds the working set. Shared so
 * every file-reading built-in caps at the same point.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Slicing a string on a UTF-16 code-unit boundary can split an astral-plane
 * char (emoji, some CJK) and leave a lone surrogate that re-encodes to U+FFFD.
 * Drop a trailing lone high surrogate so the truncated text stays valid.
 */
export function dropDanglingSurrogate(s: string): string {
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) return s.slice(0, -1);
  return s;
}

export function clampString(s: string, max: number): string {
  if (s.length <= max) return s;
  return dropDanglingSurrogate(s.slice(0, max)) + `\n... [truncated ${s.length - max} chars]`;
}

/**
 * Convert a glob pattern (`**`, `*`, `?`) to an anchored RegExp. Shared by
 * the Glob and Grep tools; not exposed externally.
 */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '[^/]')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp('^' + escaped + '$');
}
