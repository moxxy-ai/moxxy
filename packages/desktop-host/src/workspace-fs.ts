/**
 * Filesystem browsing for the agent rail's context view.
 *
 * The listDir IPC walks one directory at a time (no recursion) and
 * keeps the resolved path strictly inside the workspace's cwd. That
 * matches the "agent operates in its workspace" mental model and
 * stops the desktop UI from accidentally listing arbitrary paths on
 * disk just because someone passed `../../etc/passwd` as `path`.
 */

import { readFile as fsReadFile, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Cap a single "Open" read so a giant log can't stream MBs into the renderer. */
const MAX_READ_BYTES = 1_000_000;
/** Above this, even a text file goes through the "open anyway?" confirm — a
 *  multi-MB blob rendered in a <pre> can jank or crash the renderer. */
const CONFIRM_BYTES = 2_000_000;
/** Hard cap for inlining a binary doc (image/pdf) as base64 (base64 ~+33%). */
const INLINE_MAX_BYTES = 40_000_000;

/** Extensions we render as an inline image rather than text. */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

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
  /**
   * - `text`  — UTF-8 content to show in the viewer (`content`, maybe `truncated`)
   * - `image` — inline image (`base64` + `mediaType`)
   * - `confirm` — opening could be risky (binary blob / very large); the UI asks
   *   before re-reading with `force` and showing it as text. `reason` says why.
   */
  readonly kind: 'text' | 'image' | 'pdf' | 'confirm';
  readonly content: string;
  readonly truncated: boolean;
  /** Back-compat: true exactly when `kind === 'text'`. */
  readonly text: boolean;
  readonly byteLength: number;
  readonly mediaType?: string;
  readonly base64?: string;
  readonly reason?: 'binary' | 'large';
}

/**
 * Read a workspace file for the "Open" viewer, with the SAME cwd-scoping +
 * symlink guard as {@link listDir}. Images render inline; text/code render as
 * UTF-8 (truncated past {@link MAX_READ_BYTES}). Anything that looks binary, or
 * is larger than {@link CONFIRM_BYTES}, returns `kind: 'confirm'` so the UI can
 * ask before opening (a huge blob decoded into the renderer can crash it) — a
 * `force` re-read then decodes it as text anyway. `relPath` must resolve inside
 * the workspace.
 */
export async function readFile(
  cwd: string,
  relPath: string,
  opts: { force?: boolean } = {},
): Promise<ReadFileResult> {
  const root = await realpath(cwd).catch(() => path.resolve(cwd));
  const abs = await resolveInside(root, relPath);
  const rel = path.relative(root, abs) || path.basename(abs);
  const info = await stat(abs).catch(() => null);
  const base = { path: rel, truncated: false, text: false as boolean };
  if (!info || !info.isFile()) {
    return { ...base, kind: 'text', content: '', byteLength: 0, text: true };
  }
  const byteLength = info.size;
  const ext = path.extname(abs).toLowerCase();

  // Images + PDFs: inline as base64 so the viewer can render them natively
  // (an <img> for images, Chromium's built-in PDF viewer for PDFs).
  const imageType = IMAGE_MEDIA_TYPES[ext];
  if (imageType || ext === '.pdf') {
    if (byteLength > INLINE_MAX_BYTES && !opts.force) {
      return { ...base, kind: 'confirm', reason: 'large', content: '', byteLength };
    }
    const buf = await fsReadFile(abs);
    return {
      ...base,
      kind: imageType ? 'image' : 'pdf',
      content: '',
      byteLength,
      mediaType: imageType ?? 'application/pdf',
      base64: buf.toString('base64'),
    };
  }

  // Read only the head window via a handle, so a multi-GB file never loads whole.
  const slice = await readHead(abs, MAX_READ_BYTES);
  const looksBinary = slice.includes(0);
  if (!opts.force && (looksBinary || byteLength > CONFIRM_BYTES)) {
    return { ...base, kind: 'confirm', reason: looksBinary ? 'binary' : 'large', content: '', byteLength };
  }
  return {
    ...base,
    kind: 'text',
    content: slice.toString('utf8'),
    truncated: byteLength > slice.length,
    text: true,
    byteLength,
  };
}

/** Read at most `max` bytes from the start of a file without loading the rest. */
async function readHead(abs: string, max: number): Promise<Buffer> {
  const handle = await open(abs, 'r');
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await handle.read(buf, 0, max, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
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
  const dirents = await readdir(abs, { withFileTypes: true });
  const rows = await Promise.all(
    dirents.map(async (dirent) => {
      const name = dirent.name;
      // Strip ignored directories outright + hide hidden-by-default
      // entries unless the user is already inside one.
      if (IGNORED_DIRS.has(name)) return null;
      if (name.startsWith(HIDDEN_PREFIX) && !relPath?.includes(HIDDEN_PREFIX)) {
        return null;
      }
      // A symlink could point OUT of the workspace; reporting its name+kind
      // would disclose the existence/kind of an out-of-sandbox target, which
      // this module's doc-comment promises not to do (readFile already blocks
      // opening it). Realpath the target and drop the entry if it escapes the
      // root. Non-symlink entries are classified from the dirent directly —
      // no extra stat() syscall, and no symlink to follow.
      if (dirent.isSymbolicLink()) {
        try {
          const real = await realpath(path.join(abs, name));
          if (!isInside(root, real)) return null;
          const targetInfo = await stat(real);
          return { name, kind: targetInfo.isDirectory() ? 'dir' : 'file' } satisfies ListedEntry;
        } catch {
          return null; // dangling / unreadable symlink — omit
        }
      }
      const kind: 'file' | 'dir' = dirent.isDirectory() ? 'dir' : 'file';
      return { name, kind } satisfies ListedEntry;
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
