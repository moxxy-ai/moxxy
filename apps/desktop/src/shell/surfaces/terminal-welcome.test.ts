import { describe, expect, it } from 'vitest';
import { TERMINAL_WORDMARK, terminalWelcome } from './terminal-welcome';

/** What a terminal draws of a stream: its colour sequences are not text. */
const shown = (text: string): string => text.replace(/\u001b\[[0-9;]*m/gu, '');

/** The letters of a block word: runs of columns with ink, parted by an empty column. */
function letters(rows: ReadonlyArray<string>): number {
  const width = Math.max(...rows.map((row) => row.length));
  const inked = Array.from({ length: width }, (_, column) => rows.some((row) => (row[column] ?? ' ') !== ' '));
  return inked.filter((ink, column) => ink && !inked[column - 1]).length;
}

describe('terminalWelcome', () => {
  it('greets with the name written out, not with the mark', () => {
    const lines = shown(terminalWelcome()).split('\r\n');

    for (const row of TERMINAL_WORDMARK) expect(lines).toContain(row);
    expect(letters(TERMINAL_WORDMARK)).toBe('Moxxy'.length);
    // The mark was drawn in these.
    expect(shown(terminalWelcome())).not.toMatch(/[@%*]/u);
  });

  it('says whose shell this is', () => {
    expect(shown(terminalWelcome())).toMatch(/shared with the agent/);
  });

  it('ends on an empty line, so the shell prompt starts below it', () => {
    expect(terminalWelcome().endsWith('\r\n\r\n')).toBe(true);
  });

  it('fits the narrowest work panel without wrapping', () => {
    for (const line of shown(terminalWelcome()).split('\r\n')) expect(line.length).toBeLessThanOrEqual(48);
  });

  it('leaves the colours to the terminal theme', () => {
    // Only the 16 named colours, which the theme maps to the palette: no fixed RGB.
    expect(terminalWelcome()).not.toMatch(/\u001b\[(?:38|48);/u);
  });
});
