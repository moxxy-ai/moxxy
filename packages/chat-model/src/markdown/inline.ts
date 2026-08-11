import type { InlineTok } from './types.js';

/**
 * Match `inline code`, **bold**, *italic*, [label](url) in priority order
 * (longest-match-wins via single combined regex). Everything between
 * matches becomes a plain text token. Framework-neutral — the Ink/DOM
 * renderers map the token stream to their own elements.
 */
export function tokenizeInline(input: string): InlineTok[] {
  const out: InlineTok[] = [];
  const next = buildNextIndexes(input);
  let textStart = 0;
  let cursor = 0;
  while (cursor < input.length) {
    const parsed = parseAt(input, cursor, next);
    if (!parsed) {
      cursor += 1;
      continue;
    }
    if (cursor > textStart) out.push({ kind: 'text', value: input.slice(textStart, cursor) });
    out.push(parsed.token);
    cursor = parsed.end;
    textStart = cursor;
  }
  if (textStart < input.length) out.push({ kind: 'text', value: input.slice(textStart) });
  return out;
}

interface NextIndexes {
  readonly backtick: Int32Array;
  readonly star: Int32Array;
  readonly closeBracket: Int32Array;
  readonly closeParen: Int32Array;
  readonly newline: Int32Array;
  readonly whitespace: Int32Array;
}

function buildNextIndexes(input: string): NextIndexes {
  const backtick = new Int32Array(input.length + 1).fill(-1);
  const star = new Int32Array(input.length + 1).fill(-1);
  const closeBracket = new Int32Array(input.length + 1).fill(-1);
  const closeParen = new Int32Array(input.length + 1).fill(-1);
  const newline = new Int32Array(input.length + 1).fill(-1);
  const whitespace = new Int32Array(input.length + 1).fill(-1);
  for (let index = input.length - 1; index >= 0; index -= 1) {
    backtick[index] = input[index] === '`' ? index : (backtick[index + 1] ?? -1);
    star[index] = input[index] === '*' ? index : (star[index + 1] ?? -1);
    closeBracket[index] = input[index] === ']' ? index : (closeBracket[index + 1] ?? -1);
    closeParen[index] = input[index] === ')' ? index : (closeParen[index + 1] ?? -1);
    newline[index] = input[index] === '\n' ? index : (newline[index + 1] ?? -1);
    whitespace[index] = isWhitespace(input[index]) ? index : (whitespace[index + 1] ?? -1);
  }
  return { backtick, star, closeBracket, closeParen, newline, whitespace };
}

function parseAt(
  input: string,
  start: number,
  next: NextIndexes,
): { readonly token: InlineTok; readonly end: number } | null {
  const marker = input[start];
  if (marker === '`') {
    const close = next.backtick[start + 1] ?? -1;
    const newline = next.newline[start + 1] ?? -1;
    if (close > start + 1 && (newline === -1 || close < newline)) {
      return { token: { kind: 'code', value: input.slice(start + 1, close) }, end: close + 1 };
    }
  }
  if (marker === '*') {
    const bold = input[start + 1] === '*';
    const innerStart = start + (bold ? 2 : 1);
    const close = next.star[innerStart] ?? -1;
    const newline = next.newline[innerStart] ?? -1;
    if (close > innerStart && (newline === -1 || close < newline)) {
      if (bold && input[close + 1] === '*') {
        return { token: { kind: 'bold', value: input.slice(innerStart, close) }, end: close + 2 };
      }
      if (!bold) {
        return { token: { kind: 'italic', value: input.slice(innerStart, close) }, end: close + 1 };
      }
    }
  }
  if (marker === '[') {
    const labelEnd = next.closeBracket[start + 1] ?? -1;
    if (labelEnd > start + 1 && input[labelEnd + 1] === '(') {
      const urlStart = labelEnd + 2;
      const urlEnd = next.closeParen[urlStart] ?? -1;
      const whitespace = next.whitespace[urlStart] ?? -1;
      if (urlEnd > urlStart && (whitespace === -1 || urlEnd < whitespace)) {
        return {
          token: {
            kind: 'link',
            label: input.slice(start + 1, labelEnd),
            url: input.slice(urlStart, urlEnd),
          },
          end: urlEnd + 1,
        };
      }
    }
  }
  return null;
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/u.test(char);
}

/** Drop inline markdown markup, leaving the bare text. The patterns mirror
 *  {@link tokenizeInline} exactly (no newlines inside code/bold/italic, no
 *  whitespace in a link URL) so stripping and tokenizing agree on what counts
 *  as markup — otherwise a string could strip a span that tokenize leaves as
 *  plain text, or vice versa. */
export function stripInline(s: string): string {
  return tokenizeInline(s)
    .map((token) => token.kind === 'link' ? stripInline(token.label) : token.value)
    .join('');
}
