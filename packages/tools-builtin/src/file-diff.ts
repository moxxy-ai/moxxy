import * as path from 'node:path';
import type { DiffHunk, DiffLine, FileDiffDisplay, ToolDisplayResult } from '@moxxy/sdk';
import { fileDiffSummary } from '@moxxy/sdk';

/**
 * Build a channel-agnostic file-diff result for Write/Edit. The `display`
 * carries only the changed slices (a few lines of context per edit), never
 * the whole file, so the payload stays bounded regardless of file size.
 *
 * The line diff is a dependency-free LCS pass with common prefix/suffix
 * trimming (so a single contiguous edit only diffs the changed region). For
 * pathologically large rewrites it falls back to a single replace block and
 * marks the result `truncated`.
 */

/** Context lines kept around each change. */
const CONTEXT = 2;
/** Max diff lines emitted into hunks (display cap; full counts still reported). */
const MAX_DIFF_LINES = 400;
/** Skip the line diff entirely above this combined size (~2 MB) — summary only. */
const MAX_DIFF_BYTES = 2_000_000;
/** LCS table cell budget; above this the middle becomes one replace block. */
const LCS_CELL_BUDGET = 1_000_000;

interface Op {
  kind: 'context' | 'add' | 'del';
  text: string;
  oldNo?: number;
  newNo?: number;
}

/** Split into lines, dropping a single trailing newline (standard for diffs). */
function toLines(text: string): string[] {
  if (text.length === 0) return [];
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  return trimmed.split('\n');
}

/** Minimal-ish LCS diff of two line arrays → context/add/del ops (no numbers yet). */
function lcsDiff(a: string[], b: string[]): Array<{ kind: 'context' | 'add' | 'del'; text: string }> {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ kind: 'add' as const, text }));
  if (m === 0) return a.map((text) => ({ kind: 'del' as const, text }));
  if (n * m > LCS_CELL_BUDGET) {
    // Too big to diff cheaply — represent as a full replace of the middle.
    return [
      ...a.map((text) => ({ kind: 'del' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text })),
    ];
  }
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Array<{ kind: 'context' | 'add' | 'del'; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'context', text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: 'del', text: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ kind: 'del', text: a[i++]! });
  while (j < m) ops.push({ kind: 'add', text: b[j++]! });
  return ops;
}

/** Whole-file ops with running 1-based line numbers, using prefix/suffix trim. */
function computeOps(before: string[], after: string[]): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB -= 1;
    endA -= 1;
  }
  const middle = lcsDiff(before.slice(start, endB), after.slice(start, endA));

  const ops: Op[] = [];
  let oldNo = 1;
  let newNo = 1;
  const pushContext = (text: string): void => {
    ops.push({ kind: 'context', text, oldNo, newNo });
    oldNo += 1;
    newNo += 1;
  };
  for (let k = 0; k < start; k += 1) pushContext(before[k]!);
  for (const op of middle) {
    if (op.kind === 'context') pushContext(op.text);
    else if (op.kind === 'del') ops.push({ kind: 'del', text: op.text, oldNo: oldNo++ });
    else ops.push({ kind: 'add', text: op.text, newNo: newNo++ });
  }
  for (let k = endB; k < before.length; k += 1) pushContext(before[k]!);
  return ops;
}

/** Group ops into hunks (changed regions + CONTEXT lines), capped at MAX_DIFF_LINES. */
function buildHunks(ops: Op[]): { hunks: DiffHunk[]; truncated: boolean } {
  const changed: number[] = [];
  ops.forEach((op, i) => {
    if (op.kind !== 'context') changed.push(i);
  });
  if (changed.length === 0) return { hunks: [], truncated: false };

  // Merge per-change context windows into ranges.
  const ranges: Array<[number, number]> = [];
  for (const idx of changed) {
    const lo = Math.max(0, idx - CONTEXT);
    const hi = Math.min(ops.length - 1, idx + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }

  const hunks: DiffHunk[] = [];
  let emitted = 0;
  let truncated = false;
  for (const [lo, hi] of ranges) {
    if (truncated) break;
    const lines: DiffLine[] = [];
    let oldStart = 0;
    let newStart = 0;
    let oldLines = 0;
    let newLines = 0;
    for (let i = lo; i <= hi; i += 1) {
      if (emitted >= MAX_DIFF_LINES) {
        truncated = true;
        break;
      }
      const op = ops[i]!;
      lines.push({ kind: op.kind, text: op.text, oldNo: op.oldNo, newNo: op.newNo });
      emitted += 1;
      if (op.oldNo !== undefined) {
        if (oldStart === 0) oldStart = op.oldNo;
        oldLines += 1;
      }
      if (op.newNo !== undefined) {
        if (newStart === 0) newStart = op.newNo;
        newLines += 1;
      }
    }
    if (lines.length > 0) hunks.push({ oldStart, oldLines, newStart, newLines, lines });
  }
  return { hunks, truncated };
}

function relForDisplay(cwd: string, absPath: string): string {
  const rel = path.relative(cwd, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return absPath;
  return rel;
}

export function buildFileDiffDisplay(args: {
  cwd: string;
  absPath: string;
  before: string;
  after: string;
  mode: 'create' | 'update';
}): ToolDisplayResult {
  const { cwd, absPath, before, after, mode } = args;
  const displayPath = relForDisplay(cwd, absPath);

  // Bail on huge inputs: still report a summary, just no rendered slices.
  if (before.length + after.length > MAX_DIFF_BYTES) {
    const display: FileDiffDisplay = {
      kind: 'file-diff',
      path: displayPath,
      mode,
      added: toLines(after).length,
      removed: toLines(before).length,
      hunks: [],
      truncated: true,
    };
    return { forModel: forModelLine(absPath, mode, display), display };
  }

  const ops = computeOps(toLines(before), toLines(after));
  const added = ops.reduce((n, op) => n + (op.kind === 'add' ? 1 : 0), 0);
  const removed = ops.reduce((n, op) => n + (op.kind === 'del' ? 1 : 0), 0);
  const { hunks, truncated } = buildHunks(ops);

  const display: FileDiffDisplay = {
    kind: 'file-diff',
    path: displayPath,
    mode,
    added,
    removed,
    hunks,
    ...(truncated ? { truncated: true } : {}),
  };
  return { forModel: forModelLine(absPath, mode, display), display };
}

/** Short model-facing line — keeps the absolute path the agent used. */
function forModelLine(absPath: string, mode: 'create' | 'update', d: FileDiffDisplay): string {
  const verb = mode === 'create' ? 'created' : 'edited';
  return `${verb} ${absPath} — ${fileDiffSummary(d).toLowerCase()}`;
}
