import { colors } from '../colors.js';

/**
 * Shared formatter for `moxxy <command> --help` output. Produces the
 * same look-and-feel as `moxxy channels` and the top-level `moxxy
 * --help`: a one-line bold title, an optional dim subtitle, then
 * section blocks with bold padded labels + dim descriptions.
 *
 * Sections may also include "notes": free-form dim paragraphs printed
 * under the rows.
 */
export interface HelpSection {
  readonly title: string;
  readonly rows?: ReadonlyArray<readonly [string, string]>;
  readonly notes?: ReadonlyArray<string>;
}

export interface HelpDoc {
  /** The command name as the user types it, e.g. "moxxy plugins". */
  readonly title: string;
  /** One-line subtitle right under the title (rendered dim). */
  readonly tagline?: string;
  readonly sections: ReadonlyArray<HelpSection>;
  /** Optional trailing prose paragraphs (each rendered dim). */
  readonly footer?: ReadonlyArray<string>;
}

const ROW_INDENT = 2;

export function wrapHelpText(text: string, width: number): ReadonlyArray<string> {
  const safeWidth = Math.max(1, width);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const chunks = words.flatMap((word) => {
    if (word.length <= safeWidth) return [word];
    const parts: string[] = [];
    for (let offset = 0; offset < word.length; offset += safeWidth) {
      parts.push(word.slice(offset, offset + safeWidth));
    }
    return parts;
  });

  const lines: string[] = [];
  let line = '';
  for (const chunk of chunks) {
    if (!line) {
      line = chunk;
      continue;
    }
    if (line.length + 1 + chunk.length <= safeWidth) {
      line += ` ${chunk}`;
      continue;
    }
    lines.push(line);
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

export function formatHelp(doc: HelpDoc, width = process.stdout.columns ?? 80): string {
  const safeWidth = Math.max(24, width);

  const out: string[] = [];
  out.push(colors.bold(doc.title));
  if (doc.tagline) {
    for (const line of wrapHelpText(doc.tagline, safeWidth - ROW_INDENT)) {
      out.push(colors.dim(' '.repeat(ROW_INDENT) + line));
    }
  }
  out.push('');

  doc.sections.forEach((section, idx) => {
    out.push(colors.bold(section.title));
    const labels = (section.rows ?? []).map(([label]) => label.length);
    const colWidth = labels.length > 0 ? Math.max(...labels) : 0;
    const prefixWidth = ROW_INDENT + colWidth + 2;
    const descriptionWidth = safeWidth - prefixWidth;
    for (const [label, desc] of section.rows ?? []) {
      if (descriptionWidth >= 24) {
        const padded = label.padEnd(colWidth, ' ');
        const lines = wrapHelpText(desc, descriptionWidth);
        out.push(
          `${' '.repeat(ROW_INDENT)}${colors.bold(padded)}  ${colors.dim(lines[0] ?? '')}`,
        );
        for (const line of lines.slice(1)) {
          out.push(`${' '.repeat(prefixWidth)}${colors.dim(line)}`);
        }
        continue;
      }

      out.push(`${' '.repeat(ROW_INDENT)}${colors.bold(label)}`);
      for (const line of wrapHelpText(desc, safeWidth - ROW_INDENT * 2)) {
        out.push(`${' '.repeat(ROW_INDENT * 2)}${colors.dim(line)}`);
      }
    }
    for (const note of section.notes ?? []) {
      for (const line of wrapHelpText(note, safeWidth - ROW_INDENT)) {
        out.push(`${' '.repeat(ROW_INDENT)}${colors.dim(line)}`);
      }
    }
    if (idx < doc.sections.length - 1) out.push('');
  });

  const footer = doc.footer;
  if (footer && footer.length > 0) {
    out.push('');
    footer.forEach((paragraph) => {
      for (const line of wrapHelpText(paragraph, safeWidth)) {
        out.push(colors.dim(line));
      }
    });
  }

  return out.join('\n') + '\n';
}
