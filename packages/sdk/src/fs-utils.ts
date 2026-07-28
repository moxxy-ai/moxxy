import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, promises as fsp, renameSync, rmSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface WriteFileAtomicOptions {
  /** Mode for the final file, e.g. `0o600` for secrets. Enforced past umask. */
  readonly mode?: number;
  /** Encoding when `data` is a string. Defaults to `'utf8'`. Ignored for bytes. */
  readonly encoding?: BufferEncoding;
}

/**
 * The private-path helpers below dispatch through `fs.promises` rather than
 * destructured `node:fs/promises` bindings so the framework keeps ONE mockable
 * filesystem boundary: a destructured binding is captured at import time and no
 * longer observable, which silently blinds the regression guards that count
 * `fs.open` / `fs.mkdir` calls (persistence.ready.test.ts).
 */

/** Owner-only directory: no group/other bits, so nobody else can even traverse in. */
export const PRIVATE_DIR_MODE = 0o700;
/** Owner-only file. */
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Crash-atomic file write: write a unique sibling temp file, then `rename` it
 * over the target. POSIX `rename` is atomic on the same filesystem, so a crash
 * (or full disk) mid-write leaves the previous file intact rather than a
 * truncated one. The temp name carries pid + a random UUID so concurrent
 * writers to the same target never collide on the temp path.
 *
 * This is the single home for the framework's "persist atomically" invariant —
 * every file-state writer (vault, memory, permissions, sessions, the Write/Edit
 * tools) should call this instead of hand-rolling tmp+rename or writing in place.
 */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  opts: WriteFileAtomicOptions = {},
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data, { encoding: opts.encoding ?? 'utf8' });
    // chmod explicitly: writeFile's mode option is masked by umask, but a
    // 0o600 secret file must be exactly 0o600 regardless of the host umask.
    if (opts.mode != null) await chmod(tmp, opts.mode);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Synchronous twin of {@link writeFileAtomic}, for the few call sites that
 * cannot be async — boot/bootstrap and self-update gates that run before the
 * event loop is the right tool. Same crash-atomic guarantee: write a unique
 * sibling temp file, then `rename` it over the target. Hand-rolled
 * `mkdirSync + writeFileSync(tmp) + renameSync` copies should call this instead.
 */
export function writeFileAtomicSync(
  target: string,
  data: string | Uint8Array,
  opts: WriteFileAtomicOptions = {},
): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, data, { encoding: opts.encoding ?? 'utf8' });
    // chmod explicitly: writeFileSync's mode option is masked by umask, but a
    // 0o600 secret file must be exactly 0o600 regardless of the host umask.
    if (opts.mode != null) chmodSync(tmp, opts.mode);
    renameSync(tmp, target);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}

/**
 * The moxxy home directory: `$MOXXY_HOME` when set, else `~/.moxxy`. Single
 * source of truth so the env override is honored uniformly — previously half
 * the plugins inlined `~/.moxxy` and ignored `MOXXY_HOME`.
 */
export function moxxyHome(): string {
  return process.env.MOXXY_HOME ?? join(homedir(), '.moxxy');
}

/** Join path segments under {@link moxxyHome}. */
export function moxxyPath(...segments: string[]): string {
  return join(moxxyHome(), ...segments);
}

/**
 * POSIX permission bits are meaningless on Windows (`chmod` only toggles the
 * read-only flag; access is governed by ACLs), so the tightening helpers below
 * are no-ops there rather than pretending to enforce something they cannot.
 */
const POSIX_PERMS = process.platform !== 'win32';

/** Group/other bits. Their presence is what makes a path readable by another
 *  local account, and is the only condition worth a `chmod` syscall. */
const GROUP_OTHER = 0o077;

/**
 * `mkdir -p` a directory that must stay owner-only, tightening it when it
 * already exists with looser bits.
 *
 * The tightening pass is what makes this safe to adopt mid-life: installs
 * created before this was enforced have a `0755` directory on disk, and
 * `mkdir` is a no-op on an existing path, so mode alone would never fix them.
 *
 * Best-effort by design: a permission error (a directory owned by another user,
 * an exotic filesystem, a network mount) must never take down a boot whose only
 * problem is that a chmod did not stick. Directory CREATION still throws, since
 * failing to create the state directory is a real failure.
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await tightenIfLoose(dir, PRIVATE_DIR_MODE);
}

/**
 * Create-if-absent a file that must stay owner-only, tightening it when it
 * already exists with looser bits. `open(path, 'a')` creates with
 * `0o666 & ~umask` (typically `0644`), so an append-only log needs the mode
 * applied explicitly and retroactively.
 */
export async function ensurePrivateFile(file: string): Promise<void> {
  const handle = await fsp.open(file, 'a', PRIVATE_FILE_MODE);
  await handle.close();
  await tightenIfLoose(file, PRIVATE_FILE_MODE);
}

async function tightenIfLoose(target: string, mode: number): Promise<void> {
  if (!POSIX_PERMS) return;
  try {
    const st = await fsp.stat(target);
    if ((st.mode & GROUP_OTHER) === 0) return;
    await fsp.chmod(target, mode);
  } catch {
    /* best-effort: never fail a boot over a chmod */
  }
}

/**
 * The temp-file shape {@link writeFileAtomic} renames from:
 * `<target>.<pid>.<uuid>.tmp`. Anchored, and specific enough that a user file
 * that merely ends in `.tmp` can never match.
 */
const ATOMIC_TMP = /\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;

/** Age past which an atomic-write temp file is certainly abandoned. A live
 *  write is sub-second; anything a day old outlived the process that made it. */
const STALE_TMP_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete abandoned {@link writeFileAtomic} temp files in `dirs`.
 *
 * `writeFileAtomic` unlinks its temp file when the write throws, but it cannot
 * when the process is `SIGKILL`ed mid-write, so residue accumulates for the
 * life of the install (six such files, the oldest a month old, prompted this).
 *
 * Two properties keep this safe against a CONCURRENT moxxy process writing to
 * the same directory: only the exact `.<pid>.<uuid>.tmp` shape is considered,
 * and only entries older than {@link STALE_TMP_AGE_MS}. A temp file that is
 * still live is milliseconds old and can never be selected.
 *
 * Non-recursive and fully best-effort: it returns the number removed and never
 * throws, so callers can fire it detached at boot without guarding it.
 */
export async function pruneStaleTempFiles(
  dirs: ReadonlyArray<string>,
  now = Date.now(),
): Promise<number> {
  let removed = 0;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!ATOMIC_TMP.test(name)) continue;
      const full = join(dir, name);
      try {
        const st = await fsp.stat(full);
        if (now - st.mtimeMs < STALE_TMP_AGE_MS) continue;
        await fsp.rm(full, { force: true });
        removed++;
      } catch {
        /* raced with another pruner, or not ours to delete */
      }
    }
  }
  return removed;
}
