import { describe, expect, it } from 'vitest';

import { lastNonEmptyLineShown, tailForViewport } from './StreamingPreview.js';

describe('tailForViewport', () => {
  it('is now an identity passthrough — truncation lives in the renderer', () => {
    const content = 'line 1\nline 2\nline 3';
    expect(tailForViewport(content)).toBe(content);
  });

  it('preserves long inputs untouched (StreamingPreview handles compact vs full rendering)', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    expect(tailForViewport(lines)).toBe(lines);
  });
});

/**
 * The ORIGINAL renderer logic, verbatim, kept as the golden reference. The
 * optimized `lastNonEmptyLineShown` must be byte-identical to this for every
 * input — it only changes the algorithm's shape (no full `split` per chunk).
 */
function refShown(content: string, innerCols: number): string {
  const lines = content.split('\n');
  let line = '';
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.trim()) {
      line = lines[i]!;
      break;
    }
  }
  if (!line) line = lines[lines.length - 1] ?? '';
  return line.length > innerCols
    ? `…${line.slice(line.length - (innerCols - 1))}`
    : line;
}

describe('lastNonEmptyLineShown — byte-identical to the split-based original', () => {
  const cases: Array<[string, number]> = [
    ['', 20],
    ['hello', 20],
    ['hello world', 4],
    ['line1\nline2\nline3', 20],
    ['line1\nline2\n', 20], // trailing newline → blank last line, fall back up
    ['a\n\n\n', 20], // only the first line is non-empty
    ['\n\n\n', 20], // all blank → last (empty) line
    ['   \n   ', 20], // whitespace-only lines → last line (whitespace)
    ['head\n   \n   ', 20], // skip trailing whitespace lines back to "head"
    ['a'.repeat(100), 20], // single long line → ellipsis tail
    ['x\n' + 'y'.repeat(100), 20], // long last line
    ['short\n' + 'z'.repeat(30) + '\n', 25], // long line then trailing blank
    ['exactly', 7], // length === innerCols (no ellipsis)
    ['exactly!', 7], // length > innerCols (ellipsis)
    ['tab\there', 20],
    ['  leading and trailing  ', 50],
  ];

  it.each(cases)('content=%j innerCols=%d', (content, innerCols) => {
    expect(lastNonEmptyLineShown(content, innerCols)).toBe(refShown(content, innerCols));
  });

  it('matches across a simulated growing stream (step-by-step)', () => {
    const chunks = [
      'Hello',
      ' wor',
      'ld\n',
      'second line ',
      'grows',
      ' and grows ',
      'longer\n',
      '   ',
      '\n',
      'fin',
    ];
    let acc = '';
    for (const c of chunks) {
      acc += c;
      for (const cols of [4, 20, 80]) {
        expect(lastNonEmptyLineShown(acc, cols)).toBe(refShown(acc, cols));
      }
    }
  });

  it('matches on a large buffer with many prior lines', () => {
    const body = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
    const acc = body + '\n' + 'z'.repeat(120);
    for (const cols of [10, 48, 200]) {
      expect(lastNonEmptyLineShown(acc, cols)).toBe(refShown(acc, cols));
    }
  });
});
