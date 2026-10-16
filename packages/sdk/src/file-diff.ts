import type { DiffHunk, DiffLine, FileDiffDisplay } from './tool-display.js';

/**
 * File changes as `file-diff` displays, from what is at hand: the text before
 * and after (Moxxy's Write/Edit, OpenCode), or patch hunks the agent already
 * made (Claude's structured patch, Codex's unified diff). Only the changed
 * slices are kept, so a display stays small whatever the file's size.
 */

/** A hunk as patches write it: lines prefixed with ' ', '+' or '-'. */
export interface PatchHunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: ReadonlyArray<string>;
}

interface FileDiffTarget {
  /** As the diff shows it; see `diffPathIn`. */
  readonly path: string;
  readonly mode: 'create' | 'update';
}

/** Context lines kept around each change. */
const CONTEXT = 2;
/** Diff lines shown at most; the counts still cover every line. */
const MAX_DIFF_LINES = 400;
/** Above this combined size (~2 MB) only the counts are given. */
const MAX_DIFF_BYTES = 2_000_000;
/** LCS table cell budget; above it the changed middle is one replace block. */
const LCS_CELL_BUDGET = 1_000_000;

type Change = { readonly kind: DiffLine['kind']; readonly text: string };

export function fileDiffFromText(args: FileDiffTarget & { readonly before: string; readonly after: string }): FileDiffDisplay {
  const before = toLines(args.before);
  const after = toLines(args.after);
  if (args.before.length + args.after.length > MAX_DIFF_BYTES) {
    return { kind: 'file-diff', path: args.path, mode: args.mode, added: after.length, removed: before.length, hunks: [], truncated: true };
  }
  const lines = numberLines(1, 1, changesBetween(before, after));
  const { hunks, truncated } = hunksAround(lines);
  return display(args, lines, hunks, truncated);
}

export function fileDiffFromPatch(args: FileDiffTarget & { readonly hunks: ReadonlyArray<PatchHunk> }): FileDiffDisplay {
  const all: DiffLine[] = [];
  const hunks: DiffHunk[] = [];
  let shown = 0;
  let truncated = false;
  for (const hunk of args.hunks) {
    const lines = numberLines(hunk.oldStart, hunk.newStart, hunk.lines.flatMap(patchChange));
    all.push(...lines);
    if (truncated) continue;
    const kept = lines.slice(0, MAX_DIFF_LINES - shown);
    shown += kept.length;
    if (kept.length < lines.length) truncated = true;
    if (kept.length > 0) hunks.push(hunkOf(kept));
  }
  return display(args, all, hunks, truncated);
}

/** The hunks of a unified diff; file headers and anything outside a hunk are left out. */
export function parseUnifiedDiff(text: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let current: { lines: string[]; oldLeft: number; newLeft: number } | undefined;
  for (const line of text.split('\n')) {
    if (current && (current.oldLeft > 0 || current.newLeft > 0 || line.startsWith('\\'))) {
      // The header's counts say where the hunk ends; an empty line inside it is context written without its space.
      if (line.startsWith('+')) current.newLeft -= 1;
      else if (line.startsWith('-')) current.oldLeft -= 1;
      else if (!line.startsWith('\\')) {
        current.oldLeft -= 1;
        current.newLeft -= 1;
      }
      current.lines.push(line);
      continue;
    }
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!header) continue;
    current = { lines: [], oldLeft: Number(header[2] ?? 1), newLeft: Number(header[4] ?? 1) };
    hunks.push({ oldStart: Number(header[1]), newStart: Number(header[3]), lines: current.lines });
  }
  return hunks;
}

/** `file` relative to the project folder `cwd` when inside it, else as given; either separator. */
export function diffPathIn(cwd: string, file: string): string {
  let end = cwd.length;
  while (end > 0 && (cwd[end - 1] === '/' || cwd[end - 1] === '\\')) end -= 1;
  const root = cwd.slice(0, end);
  if (root && file.startsWith(root) && (file[root.length] === '/' || file[root.length] === '\\')) return file.slice(root.length + 1);
  return file;
}

function display(target: FileDiffTarget, lines: ReadonlyArray<DiffLine>, hunks: DiffHunk[], truncated: boolean): FileDiffDisplay {
  return {
    kind: 'file-diff',
    path: target.path,
    mode: target.mode,
    added: lines.filter((line) => line.kind === 'add').length,
    removed: lines.filter((line) => line.kind === 'del').length,
    hunks,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Lines of a text; a single trailing newline ends the last line, as in diffs. */
function toLines(text: string): string[] {
  if (text.length === 0) return [];
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}

function patchChange(line: string): Change[] {
  if (line.startsWith('+')) return [{ kind: 'add', text: line.slice(1) }];
  if (line.startsWith('-')) return [{ kind: 'del', text: line.slice(1) }];
  if (line.startsWith('\\')) return [];
  return [{ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line }];
}

function numberLines(oldStart: number, newStart: number, changes: ReadonlyArray<Change>): DiffLine[] {
  let oldNo = oldStart;
  let newNo = newStart;
  return changes.map((change) => {
    if (change.kind === 'add') return { kind: 'add', text: change.text, newNo: newNo++ };
    if (change.kind === 'del') return { kind: 'del', text: change.text, oldNo: oldNo++ };
    return { kind: 'context', text: change.text, oldNo: oldNo++, newNo: newNo++ };
  });
}

/** Every line of both texts in order, the common prefix and suffix trimmed before the LCS pass. */
function changesBetween(before: ReadonlyArray<string>, after: ReadonlyArray<string>): Change[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const context = (text: string): Change => ({ kind: 'context', text });
  return [
    ...before.slice(0, start).map(context),
    ...lcs(before.slice(start, endBefore), after.slice(start, endAfter)),
    ...before.slice(endBefore).map(context),
  ];
}

function lcs(a: ReadonlyArray<string>, b: ReadonlyArray<string>): Change[] {
  const removed = (text: string): Change => ({ kind: 'del', text });
  const added = (text: string): Change => ({ kind: 'add', text });
  if (a.length === 0 || b.length === 0 || a.length * b.length > LCS_CELL_BUDGET) return [...a.map(removed), ...b.map(added)];
  // common[i * width + j] = length of the longest common run of a[i:] and b[j:].
  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number): number => common[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const changes: Change[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i] ?? '';
    const right = b[j] ?? '';
    if (left === right) {
      changes.push({ kind: 'context', text: left });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      changes.push(removed(left));
      i += 1;
    } else {
      changes.push(added(right));
      j += 1;
    }
  }
  return [...changes, ...a.slice(i).map(removed), ...b.slice(j).map(added)];
}

/** The changed lines with CONTEXT lines around them, grouped into hunks and capped at MAX_DIFF_LINES. */
function hunksAround(lines: ReadonlyArray<DiffLine>): { hunks: DiffHunk[]; truncated: boolean } {
  const ranges: Array<[number, number]> = [];
  lines.forEach((line, index) => {
    if (line.kind === 'context') return;
    const lo = Math.max(0, index - CONTEXT);
    const hi = Math.min(lines.length - 1, index + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  });
  const hunks: DiffHunk[] = [];
  let shown = 0;
  for (const [lo, hi] of ranges) {
    const kept = lines.slice(lo, Math.min(hi + 1, lo + MAX_DIFF_LINES - shown));
    shown += kept.length;
    if (kept.length > 0) hunks.push(hunkOf(kept));
    if (kept.length < hi + 1 - lo) return { hunks, truncated: true };
  }
  return { hunks, truncated: false };
}

function hunkOf(lines: ReadonlyArray<DiffLine>): DiffHunk {
  const olds = lines.flatMap((line) => (line.oldNo === undefined ? [] : [line.oldNo]));
  const news = lines.flatMap((line) => (line.newNo === undefined ? [] : [line.newNo]));
  return { oldStart: olds[0] ?? 0, oldLines: olds.length, newStart: news[0] ?? 0, newLines: news.length, lines };
}
