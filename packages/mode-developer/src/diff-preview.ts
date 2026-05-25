import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DIFF_MAX_FILES, DIFF_MAX_LINES_PER_FILE } from './constants.js';

const exec = promisify(execFile);

export interface ChangedFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly diff: string;
  readonly truncated: boolean;
}

export interface ChangedFilesResult {
  readonly files: ReadonlyArray<ChangedFile>;
  /** Total tracked + untracked file count BEFORE the file-count cap was applied. */
  readonly totalFiles: number;
  /** True when the working tree had no changes at all. */
  readonly empty: boolean;
  /** Populated when git itself errored — caller should surface to the user. */
  readonly error?: string;
}

/**
 * Gather a preview of the working tree's pending changes for the commit
 * approval gate. Combines tracked-file diffs (against HEAD) with a stub
 * "new file" entry per untracked file so the user sees everything that
 * `git add -A && git commit` would capture.
 *
 * All git work is shelled out via execFile (NOT ctx.tools) because this
 * is mode infrastructure — the user shouldn't have to approve each git
 * read separately to see their own diff.
 */
export async function collectChangedFiles(cwd: string): Promise<ChangedFilesResult> {
  try {
    const tracked = await collectTrackedChanges(cwd);
    const untracked = await collectUntrackedFiles(cwd);
    const all = [...tracked, ...untracked];
    if (all.length === 0) {
      return { files: [], totalFiles: 0, empty: true };
    }
    const capped = all.slice(0, DIFF_MAX_FILES);
    return { files: capped, totalFiles: all.length, empty: false };
  } catch (err) {
    return {
      files: [],
      totalFiles: 0,
      empty: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function collectTrackedChanges(cwd: string): Promise<ChangedFile[]> {
  // numstat gives one line per changed file: <adds>\t<dels>\t<path>.
  // -M detects renames so we don't double-count them. HEAD as the base
  // captures both staged and unstaged changes against the last commit.
  const numstat = await runGit(cwd, ['diff', '--numstat', '-M', 'HEAD']);
  const lines = numstat.split('\n').filter((l) => l.trim() !== '');
  const out: ChangedFile[] = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [addsRaw, delsRaw, ...pathParts] = parts;
    const path = pathParts.join('\t');
    // Binary files show "-\t-\t<path>" in numstat; surface them without a diff body.
    const additions = addsRaw === '-' ? 0 : Number.parseInt(addsRaw ?? '0', 10);
    const deletions = delsRaw === '-' ? 0 : Number.parseInt(delsRaw ?? '0', 10);
    const isBinary = addsRaw === '-' && delsRaw === '-';
    let diff = '';
    let truncated = false;
    if (isBinary) {
      diff = `(binary file — ${path})`;
    } else {
      const raw = await runGit(cwd, ['diff', '-M', 'HEAD', '--', path]);
      const { body, truncated: t } = truncateDiff(raw);
      diff = body;
      truncated = t;
    }
    out.push({ path, additions, deletions, diff, truncated });
  }
  return out;
}

async function collectUntrackedFiles(cwd: string): Promise<ChangedFile[]> {
  const status = await runGit(cwd, ['ls-files', '--others', '--exclude-standard']);
  const paths = status.split('\n').filter((l) => l.trim() !== '');
  const out: ChangedFile[] = [];
  for (const path of paths) {
    // Use diff with /dev/null vs the file to get a real unified diff body
    // for previewing. --no-index works without git tracking the file.
    let diff = '';
    let truncated = false;
    let additions = 0;
    try {
      const raw = await runGit(cwd, ['diff', '--no-index', '--', '/dev/null', path], {
        // git diff --no-index exits 1 when files differ — that's the expected case here.
        allowNonZeroExit: true,
      });
      const t = truncateDiff(raw);
      diff = t.body;
      truncated = t.truncated;
      additions = (raw.match(/^\+/gm) ?? []).length;
      // Subtract the "+++ b/<path>" header line that --no-index emits.
      additions = Math.max(0, additions - 1);
    } catch {
      diff = `(new file — ${path})`;
    }
    out.push({ path, additions, deletions: 0, diff, truncated });
  }
  return out;
}

function truncateDiff(raw: string): { body: string; truncated: boolean } {
  const lines = raw.split('\n');
  if (lines.length <= DIFF_MAX_LINES_PER_FILE) {
    return { body: raw, truncated: false };
  }
  const head = lines.slice(0, DIFF_MAX_LINES_PER_FILE).join('\n');
  return {
    body: `${head}\n… ${lines.length - DIFF_MAX_LINES_PER_FILE} more line(s) truncated`,
    truncated: true,
  };
}

interface RunOpts {
  readonly allowNonZeroExit?: boolean;
}

async function runGit(cwd: string, args: string[], opts: RunOpts = {}): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if (opts.allowNonZeroExit && err && typeof err === 'object' && 'stdout' in err) {
      return String((err as { stdout: unknown }).stdout ?? '');
    }
    throw err;
  }
}

/**
 * Render the changed-files preview as the body of an approval dialog:
 * a "Changed files" header with +/- counts, then per-file unified diffs
 * fenced in ```diff blocks so a diff-aware renderer can colorize.
 */
export function renderDiffBody(result: ChangedFilesResult): string {
  if (result.error) {
    return `Could not collect diff preview: ${result.error}`;
  }
  if (result.empty) {
    return '(No changes detected in the working tree.)';
  }
  const header: string[] = [];
  header.push(`Changed files (${result.totalFiles}):`);
  for (const f of result.files) {
    const sign = f.additions || f.deletions ? `+${f.additions}/-${f.deletions}` : '';
    header.push(`  ${f.path}${sign ? '  ' + sign : ''}`);
  }
  if (result.totalFiles > result.files.length) {
    header.push(`  … ${result.totalFiles - result.files.length} more file(s) not shown`);
  }
  header.push('');
  const blocks = result.files.map((f) => '```diff\n' + f.diff.replace(/\n+$/, '') + '\n```');
  return header.join('\n') + '\n' + blocks.join('\n\n');
}
