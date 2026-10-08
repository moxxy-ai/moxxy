import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TERMINAL_MARK, terminalWelcome } from './terminal-welcome';

/** What a terminal draws of a stream: its colour sequences are not text. */
const shown = (text: string): string => text.replace(/\u001b\[[0-9;]*m/gu, '');

describe('terminalWelcome', () => {
  it('greets with the Moxxy mark and says whose shell this is', () => {
    const lines = shown(terminalWelcome()).split('\r\n');

    for (const row of TERMINAL_MARK) expect(lines).toContain(row);
    expect(lines.some((line) => line.startsWith('Moxxy'))).toBe(true);
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

  it('draws the mark the TUI boots with', () => {
    const tui = readFileSync(join(__dirname, '../../../../../packages/plugin-cli/src/logo-data.ts'), 'utf8');
    const indent = Math.min(...tuiCompactRows(tui).map((row) => row.length - row.trimStart().length));

    expect(TERMINAL_MARK).toEqual(tuiCompactRows(tui).map((row) => row.slice(indent)));
  });
});

/** The rows of the TUI's compact mark, read from its source. */
function tuiCompactRows(source: string): string[] {
  const block = /COMPACT_LOGO_ART_RAW[^=]*=\s*\[([\s\S]*?)\];/u.exec(source)?.[1] ?? '';
  return [...block.matchAll(/'([^']*)'/gu)].map((match) => match[1] ?? '');
}
