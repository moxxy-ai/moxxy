/**
 * A Markdown table read aloud. Read cell by cell it is a list of words nobody
 * can follow ("Agent Wynik Claude 9 z 9 Codex 8 z 9"), so each row becomes one
 * sentence that names its column before every value:
 * "Claude: Wynik 9 z 9." The first cell names the row, as people read a table.
 */

const TABLE_LINE = /^\s*\|/u;
const SEPARATOR_LINE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u;

/** Whether a line can belong to a table. */
export function isTableLine(line: string): boolean {
  return TABLE_LINE.test(line);
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim());
}

/** Ending punctuation is the sentence's, not the cell's. */
function bare(cell: string): string {
  return cell.replace(/[.,;:]+$/u, '');
}

/**
 * One sentence per row of a table given as its lines, or `null` when the lines
 * are no table: Markdown needs the line of dashes under the column names.
 */
export function speakTable(lines: readonly string[]): string[] | null {
  const [header, separator, ...rows] = lines;
  if (header === undefined || separator === undefined || !SEPARATOR_LINE.test(separator)) return null;
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
    if (!isTableLine(lines[index] ?? '')) {
      out.push(lines[index] ?? '');
      index += 1;
      continue;
    }
    let end = index;
    while (end < lines.length && isTableLine(lines[end] ?? '')) end += 1;
    const block = lines.slice(index, end);
    const spoken = speakTable(block);
    out.push(...(spoken ? spoken.flatMap((sentence, at) => (at === 0 ? [sentence] : ['', sentence])) : block));
    index = end;
  }
  return out.join('\n');
}
