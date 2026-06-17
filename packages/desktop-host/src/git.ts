/**
 * Read-only git helpers for the "Files changed" pane + diff viewer.
 *
 * Everything runs `git` as a child process IN the workspace cwd (never above
 * it) and is strictly read-only (`status`, `diff`) — no mutating subcommands.
 * Each call is bounded (size cap on diffs) so a huge diff can't OOM the
 * renderer. Failures degrade to "not a repo / no changes" rather than throwing
 * into the IPC layer.
 */

import { spawn } from 'node:child_process';

/** Cap a single diff so a massive generated-file change can't stream MBs. */
const MAX_DIFF_BYTES = 1_000_000;

export interface ChangedFile {
  /** Path relative to the repo root. */
  readonly path: string;
  /** Two-letter porcelain status (e.g. ` M`, `??`, `A `, `R `). */
  readonly status: string;
}

export interface FileDiff {
  readonly path: string;
  readonly diff: string;
  readonly truncated: boolean;
}

interface GitOpts {
  readonly maxBytes?: number;
  /** Tolerate a non-zero exit (e.g. `diff --no-index` exits 1 on a difference). */
  readonly allowNonZero?: boolean;
}

/** Run `git` in `cwd`, resolving to captured stdout (utf8, capped at
 *  `maxBytes`). Rejects on a missing binary, or a non-zero exit unless
 *  `allowNonZero` — so callers can map failure → "not a repo". */
function git(cwd: string, args: ReadonlyArray<string>, opts: GitOpts = {}): Promise<{
  readonly stdout: string;
  readonly truncated: boolean;
}> {
  const maxBytes = opts.maxBytes ?? MAX_DIFF_BYTES;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let child;
    try {
      child = spawn('git', [...args], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      reject(err);
      return;
    }
    child.stdout.on('data', (b: Buffer) => {
      if (truncated) return;
      if (size + b.length > maxBytes) {
        chunks.push(b.subarray(0, maxBytes - size));
        truncated = true;
      } else {
        chunks.push(b);
        size += b.length;
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || opts.allowNonZero) {
        resolve({ stdout: Buffer.concat(chunks).toString('utf8'), truncated });
      } else {
        reject(new Error(`git ${args[0]} exited ${code}`));
      }
    });
  });
}

/** True iff `cwd` is inside a git work tree. */
export async function isRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/** Changed files via `git status --porcelain` (staged + unstaged + untracked). */
export async function status(cwd: string): Promise<ReadonlyArray<ChangedFile>> {
  try {
    // -z gives NUL-delimited paths so spaces / unicode survive; --porcelain=v1
    // keeps the stable two-column XY status prefix.
    const { stdout } = await git(cwd, ['status', '--porcelain=v1', '-z']);
    const out: ChangedFile[] = [];
    for (const entry of stdout.split('\0')) {
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      // Renames encode "old -> new" with the new path in a following NUL field;
      // the simple split keeps the first field, which is good enough for display.
      const filePath = entry.slice(3);
      if (filePath) out.push({ path: filePath, status: code });
    }
    return out;
  } catch {
    return [];
  }
}

/** Unified diff for one file (HEAD vs working tree). Untracked files have no
 *  HEAD blob, so they diff against /dev/null via `--no-index`. */
export async function diff(cwd: string, filePath: string): Promise<FileDiff> {
  // Tracked path: a plain `git diff HEAD -- <file>` covers staged + unstaged.
  try {
    const tracked = await git(cwd, ['diff', 'HEAD', '--', filePath]);
    if (tracked.stdout.trim().length > 0) {
      return { path: filePath, diff: tracked.stdout, truncated: tracked.truncated };
    }
  } catch {
    /* fall through to the untracked path */
  }
  // Untracked / new file: diff against /dev/null. `--no-index` exits 1 when
  // there's a difference (that's expected), so don't treat non-zero as failure.
  try {
    const untracked = await git(cwd, ['diff', '--no-index', '--', '/dev/null', filePath], {
      allowNonZero: true,
    });
    return { path: filePath, diff: untracked.stdout, truncated: untracked.truncated };
  } catch {
    return { path: filePath, diff: '', truncated: false };
  }
}
