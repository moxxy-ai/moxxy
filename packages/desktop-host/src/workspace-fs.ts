/**
 * Filesystem browsing for the agent rail's context view.
 *
 * The listDir IPC walks one directory at a time (no recursion) and
 * keeps the resolved path strictly inside the workspace's cwd. That
 * matches the "agent operates in its workspace" mental model and
 * stops the desktop UI from accidentally listing arbitrary paths on
 * disk just because someone passed `../../etc/passwd` as `path`.
 */

import { readFile as fsReadFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Cap a single "Open" read so a giant log can't stream MBs into the renderer. */
const MAX_READ_BYTES = 1_000_000;

const HIDDEN_PREFIX = '.';
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'dist',
  'dist-electron',
  '.next',
  '.cache',
  'coverage',
]);

export interface ListedEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir';
}

export interface ListDirResult {
  readonly cwd: string;
  readonly path: string;
  readonly entries: ReadonlyArray<ListedEntry>;
}

function isInside(root: string, abs: string): boolean {
  return abs === root || abs.startsWith(root + path.sep);
}

/**
 * Resolve `relPath` against the canonical workspace `root` and verify
 * the result stays underneath it — at BOTH the string level (catches
 * `..` / absolute paths) and the symlink level (catches a symlink inside
 * the workspace that points out of it). Pure `path.resolve` +
 * `startsWith` is not enough: it would happily traverse a symlink whose
 * resolved string still looks like a child of the root. Throws on escape.
 */
async function resolveInside(root: string, relPath: string | undefined): Promise<string> {
  const candidate = path.resolve(root, relPath ?? '.');
  if (!isInside(root, candidate)) {
    throw new Error(`path "${relPath ?? '.'}" escapes the workspace root`);
  }
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    // Doesn't exist yet — string-level confinement above is sufficient
    // (there is nothing on disk to leak).
    return candidate;
  }
  if (!isInside(root, real)) {
    throw new Error(`path "${relPath ?? '.'}" escapes the workspace root via a symlink`);
  }
  return real;
}

export interface ReadFileResult {
  readonly path: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly text: boolean;
}

/**
 * Read a workspace file's UTF-8 contents for the "Open" file viewer, with the
 * SAME cwd-scoping + symlink guard as {@link listDir}. Binary files (a NUL byte
 * in the first chunk) return a placeholder rather than mojibake; oversized files
 * are truncated to a head excerpt. `relPath` must resolve inside the workspace.
 */
export async function readFile(cwd: string, relPath: string): Promise<ReadFileResult> {
  const root = await realpath(cwd).catch(() => path.resolve(cwd));
  const abs = await resolveInside(root, relPath);
  const rel = path.relative(root, abs) || path.basename(abs);
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile()) {
    return { path: rel, content: '', truncated: false, text: false };
  }
  const buf = await fsReadFile(abs);
  const slice = buf.subarray(0, MAX_READ_BYTES);
  const truncated = buf.length > MAX_READ_BYTES;
  // A NUL byte in the read window is the same binary heuristic buildAttachments
  // uses — text decode would otherwise produce unreadable replacement chars.
  if (slice.includes(0)) {
    return { path: rel, content: `[binary file — ${buf.length} bytes]`, truncated: false, text: false };
  }
  return { path: rel, content: slice.toString('utf8'), truncated, text: true };
}

export async function listDir(cwd: string, relPath?: string): Promise<ListDirResult> {
  // Canonicalise the workspace root once so the symlink check below
  // compares like-for-like (e.g. macOS /var → /private/var).
  const root = await realpath(cwd).catch(() => path.resolve(cwd));
  const abs = await resolveInside(root, relPath);
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isDirectory()) {
    return {
      cwd: root,
      path: path.relative(root, abs) || '.',
      entries: [],
    };
  }
  const names = await readdir(abs);
  const rows = await Promise.all(
    names.map(async (name) => {
      // Strip ignored directories outright + hide hidden-by-default
      // entries unless the user is already inside one.
      if (IGNORED_DIRS.has(name)) return null;
      if (name.startsWith(HIDDEN_PREFIX) && !relPath?.includes(HIDDEN_PREFIX)) {
        return null;
      }
      try {
        const s = await stat(path.join(abs, name));
        const kind: 'file' | 'dir' = s.isDirectory() ? 'dir' : 'file';
        return { name, kind } satisfies ListedEntry;
      } catch {
        return null;
      }
    }),
  );
  const entries = rows.filter((r): r is ListedEntry => r !== null);
  // Folders before files, alphabetic within each group.
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    cwd: root,
    path: path.relative(root, abs) || '.',
    entries,
  };
}
