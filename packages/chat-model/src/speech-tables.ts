/**
 * A Markdown table read aloud. Read cell by cell it is a list of words nobody
 * can follow ("Agent Wynik Claude 9 z 9 Codex 8 z 9"), so each row becomes one
 * sentence that names its column before every value:
 * "Claude: Wynik 9 z 9." The first cell names the row, as people read a table.
 */

import { trimTrailing } from './trim-trailing.js';

const TABLE_LINE = /^\s*\|/u;
/** One cell of the line of dashes, checked per cell: one pattern for the whole line backtracks on long runs of spaces. */
const SEPARATOR_CELL = /^:?-{3,}:?$/u;
const SENTENCE_PUNCTUATION = new Set(['.', ',', ';', ':']);

/** A line that starts with a pipe, as most tables are written. */
export function isTableLine(line: string): boolean {
  return TABLE_LINE.test(line);
}

/** A line that can be a row: Markdown also allows a table without the pipes at its edges. */
export function isTableRow(line: string | undefined): boolean {
  return line !== undefined && line.includes('|') && line.trim() !== '';
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim());
}

/** A line of dashes under every column of `header`; a lone `---` under prose is a heading underline. */
function isSeparatorFor(header: string, line: string | undefined): boolean {
  if (line === undefined) return false;
  const marks = cells(line);
  return marks.length === cells(header).length && marks.every((mark) => SEPARATOR_CELL.test(mark));
}

/** A table starts at `lines[index]`: a row of names with its line of dashes under it. */
function tableStartsAt(lines: readonly string[], index: number): boolean {
  const header = lines[index];
  return header !== undefined && isTableRow(header) && isSeparatorFor(header, lines[index + 1]);
}

/** `text` starts with a table, or with a line that already shows it will be one. */
export function startsTable(text: string): boolean {
  return isTableLine(text) || tableStartsAt(text.split('\n', 2), 0);
}

/** How many lines from `index` a table that starts there takes. */
function tableLength(lines: readonly string[], index: number): number {
  let end = index + 2;
  while (isTableRow(lines[end])) end += 1;
  return end - index;
}

/** Ending punctuation is the sentence's, not the cell's. */
function bare(cell: string): string {
  return trimTrailing(cell, SENTENCE_PUNCTUATION);
}

/**
 * One sentence per row of a table given as its lines, or `null` when the lines
 * are no table: Markdown needs the line of dashes under the column names.
 */
export function speakTable(lines: readonly string[]): string[] | null {
  if (!tableStartsAt(lines, 0)) return null;
  const [header = '', , ...rows] = lines;
  const names = cells(header);
  return rows
    .map((row) => {
      const [first = '', ...rest] = cells(row).map(bare);
      const values = rest
        .map((value, index) => (value ? `${names[index + 1] ?? ''} ${value}`.trim() : ''))
        .filter(Boolean);
      if (!first) return values.length ? `${values.join('; ')}.` : '';
      return values.length ? `${first}: ${values.join('; ')}.` : `${first}.`;
    })
    .filter(Boolean);
}

/** Every table in `markdown` read as sentences, one paragraph per row; the rest stays as it was. */
export function speakMarkdownTables(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (!tableStartsAt(lines, index)) {
      out.push(lines[index] ?? '');
      index += 1;
      continue;
    }
    const length = tableLength(lines, index);
    const spoken = speakTable(lines.slice(index, index + length)) ?? [];
    out.push(...spoken.flatMap((sentence, at) => (at === 0 ? [sentence] : ['', sentence])));
    index += length;
  }
  return out.join('\n');
}
