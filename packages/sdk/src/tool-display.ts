/**
 * Channel-agnostic "rich tool result" payloads.
 *
 * A tool whose result is more than a line of text (a file diff, eventually a
 * table or chart) returns a `ToolDisplayResult`: a short `forModel` string the
 * model sees, plus a structured `display` every channel can render natively.
 * The projection layer (see `mode-helpers.ts`) sends ONLY `forModel` to the
 * model, so the rich payload never bloats the context window.
 *
 * `question-answer` (from `ask_user`) keeps what the person chose, so the
 * transcript still shows it once the Question's card is gone.
 *
 * `file-diff` is emitted by the built-in Write/Edit tools, and by agent connections for the agent's own
 * edits (built with `file-diff.ts`). It carries the changed slices of a file (a few
 * lines of context around each edit) — never the whole file — so the payload
 * stays bounded regardless of file size. Channels render it as a classic diff:
 * line numbers, +/- markers, green/red line backgrounds.
 */

/** One rendered line of a diff. */
export interface DiffLine {
  readonly kind: 'context' | 'add' | 'del';
  readonly text: string;
  /** 1-based line number in the OLD file (del + context lines). */
  readonly oldNo?: number;
  /** 1-based line number in the NEW file (add + context lines). */
  readonly newNo?: number;
}

/** A contiguous changed region plus its surrounding context lines. */
export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: ReadonlyArray<DiffLine>;
}

/** Structured diff for a single file write/edit. */
export interface FileDiffDisplay {
  readonly kind: 'file-diff';
  /** Display path — relative to cwd when possible, else absolute. */
  readonly path: string;
  readonly mode: 'create' | 'update';
  readonly added: number;
  readonly removed: number;
  readonly hunks: ReadonlyArray<DiffHunk>;
  /** Set when a very large diff was capped (some hunks/lines dropped). */
  readonly truncated?: boolean;
}

/** One question the person answered, as words: what was asked and what they chose. */
export interface AnsweredQuestion {
  readonly header?: string;
  readonly question: string;
  /** Labels of the suggested answers they picked, in order. */
  readonly chosen: ReadonlyArray<string>;
  /** Their answer in their own words, when they wrote one. */
  readonly own?: string;
}

/**
 * The answers to a Question (`ask_user`), kept so the transcript shows what the
 * person chose after the card is gone.
 */
export interface QuestionAnswerDisplay {
  readonly kind: 'question-answer';
  readonly questions: ReadonlyArray<AnsweredQuestion>;
}

/** Extensible union of structured tool-result payloads. */
export type ToolDisplay = FileDiffDisplay | QuestionAnswerDisplay;

/**
 * The shape a tool returns when it wants a rich, channel-rendered result.
 * `forModel` is the only thing the model sees; `display` is for channels.
 */
export interface ToolDisplayResult {
  readonly forModel: string;
  readonly display: ToolDisplay;
}

export function isToolDisplayResult(x: unknown): x is ToolDisplayResult {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { forModel?: unknown }).forModel === 'string' &&
    isToolDisplay((x as { display?: unknown }).display)
  );
}

export function isToolDisplay(x: unknown): x is ToolDisplay {
  return isFileDiffDisplay(x) || isQuestionAnswerDisplay(x);
}

export function isQuestionAnswerDisplay(x: unknown): x is QuestionAnswerDisplay {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as { kind?: unknown; questions?: unknown };
  if (d.kind !== 'question-answer' || !Array.isArray(d.questions)) return false;
  return d.questions.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    const q = item as { question?: unknown; chosen?: unknown; own?: unknown };
    return (
      typeof q.question === 'string' &&
      Array.isArray(q.chosen) &&
      q.chosen.every((label) => typeof label === 'string') &&
      (q.own === undefined || typeof q.own === 'string')
    );
  });
}

/** One line per answered question, e.g. "Colour: Which colour? → Blue", for text surfaces. */
export function questionAnswerLines(d: QuestionAnswerDisplay): string[] {
  return d.questions.map((item) => {
    const said = [...(item.chosen.length > 0 ? [item.chosen.join(', ')] : []), ...(item.own ? [`own answer: ${item.own}`] : [])];
    return `${item.header ? `${item.header}: ` : ''}${item.question} → ${said.join('; ')}`;
  });
}

export function isFileDiffDisplay(x: unknown): x is FileDiffDisplay {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as {
    kind?: unknown;
    path?: unknown;
    added?: unknown;
    removed?: unknown;
    hunks?: unknown;
  };
  if (d.kind !== 'file-diff') return false;
  // Validate the load-bearing shape, not just `kind` + a `hunks` array: this
  // guard decides whether a tool result is TRUSTED as a structured diff (the
  // model is then shown only `forModel`, and channels render the payload). A
  // malformed object with a bogus path / non-numeric counts / a non-array hunk
  // must be rejected, not silently rendered.
  if (typeof d.path !== 'string') return false;
  if (typeof d.added !== 'number' || typeof d.removed !== 'number') return false;
  if (!Array.isArray(d.hunks)) return false;
  for (const hunk of d.hunks) {
    if (typeof hunk !== 'object' || hunk === null) return false;
    if (!Array.isArray((hunk as { lines?: unknown }).lines)) return false;
  }
  return true;
}

/** Pixels a tool result carries, as base64. */
export interface ToolImage {
  readonly mediaType: string;
  readonly base64: string;
}

/**
 * The image in a tool output and the text beside it, or `null`. A tool returns
 * `{ mediaType, base64, forModel? }` (Moxxy's screenshot tools, agent
 * connections) or the provider-native `{ type: 'image', mediaType, data }`.
 */
export function toolImageOf(output: unknown): { readonly image: ToolImage; readonly text: string } | null {
  if (typeof output !== 'object' || output === null) return null;
  const o = output as { type?: unknown; mediaType?: unknown; base64?: unknown; data?: unknown; forModel?: unknown };
  if (typeof o.mediaType !== 'string') return null;
  const base64 = typeof o.base64 === 'string' ? o.base64 : o.type === 'image' && typeof o.data === 'string' ? o.data : null;
  if (base64 === null) return null;
  return { image: { mediaType: o.mediaType, base64 }, text: typeof o.forModel === 'string' ? o.forModel : '' };
}

/** A tool output holding one image and the text the agent read beside it. */
export function imageToolOutput(text: string, image: ToolImage): { readonly forModel: string; readonly mediaType: string; readonly base64: string } {
  return { forModel: text, mediaType: image.mediaType, base64: image.base64 };
}

/** Human summary, e.g. "Added 10 lines, removed 1 line". */
export function fileDiffSummary(d: FileDiffDisplay): string {
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (d.added > 0 || d.removed === 0) parts.push(`Added ${plural(d.added, 'line')}`);
  if (d.removed > 0) parts.push(`${parts.length ? 'removed' : 'Removed'} ${plural(d.removed, 'line')}`);
  let summary = parts.join(', ');
  if (d.truncated) summary += ' (diff truncated)';
  return summary;
}

/** Verb for the diff header — "Create" for new files, else "Update". */
export function fileDiffVerb(d: FileDiffDisplay): string {
  return d.mode === 'create' ? 'Create' : 'Update';
}

/** Gutter number a renderer should show for a line (new number, or old for deletions). */
export function diffGutterNo(line: DiffLine): number | undefined {
  return line.kind === 'del' ? line.oldNo : line.newNo;
}

/** A renderable row: either a diff line or a gap marker between hunks. */
export type DiffRow = DiffLine | { readonly kind: 'gap' };

/**
 * Flatten a file diff's hunks into a single row list, inserting a `gap` marker
 * between non-contiguous hunks (channels render it as a `⋯` separator).
 */
export function toDiffRows(d: FileDiffDisplay): DiffRow[] {
  const rows: DiffRow[] = [];
  d.hunks.forEach((hunk, i) => {
    if (i > 0) rows.push({ kind: 'gap' });
    for (const line of hunk.lines) rows.push(line);
  });
  return rows;
}
