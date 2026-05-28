import { randomUUID } from 'node:crypto';
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
