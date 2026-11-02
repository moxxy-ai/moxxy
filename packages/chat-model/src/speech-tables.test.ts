import { describe, expect, it } from 'vitest';

import { speakMarkdownTables, speakTable } from './speech-tables.js';

const RESULTS = [
  '| Agent | Wersja i model | Wynik |',
  '|---|---|---|',
  '| Claude | 2.1.316, Haiku 5.5 | 9 z 9 zaliczone |',
  '| **Codex** | 0.166.0 | 9 z 9 zaliczone. |',
];

describe('speakTable', () => {
  it('reads each row on its own, every value with the name of its column', () => {
    expect(speakTable(RESULTS)).toEqual([
      'Claude: Wersja i model 2.1.316, Haiku 5.5; Wynik 9 z 9 zaliczone.',
      '**Codex**: Wersja i model 0.166.0; Wynik 9 z 9 zaliczone.',
    ]);
  });

  it('skips an empty cell instead of naming a column with nothing in it', () => {
    expect(speakTable(['| Plik | Stan | Uwagi |', '| :--- | :---: | ---: |', '| a.ts | gotowy |  |'])).toEqual([
      'a.ts: Stan gotowy.',
    ]);
  });

  it('reads a table of one column as its values', () => {
    expect(speakTable(['| Kroki |', '|---|', '| Zbuduj |', '| Przetestuj |'])).toEqual(['Zbuduj.', 'Przetestuj.']);
  });

  it('reads a table written without the pipes at the edges', () => {
    expect(speakTable(['Agent | Wynik', '--- | ---', 'Claude | 9 z 9', 'Codex | 8 z 9'])).toEqual([
      'Claude: Wynik 9 z 9.',
      'Codex: Wynik 8 z 9.',
    ]);
  });

  it('is no table when the dashes do not stand under every column', () => {
    expect(speakTable(['a | b', '---'])).toBeNull();
    expect(speakTable(['| a | b |', '|---|'])).toBeNull();
  });

  it('stays fast on a long line that only almost looks like a table', () => {
    const started = performance.now();
    expect(speakTable(['a | b', `---${' '.repeat(50_000)}x`])).toBeNull();
    expect(speakTable(['| a | b |', '|---|---|', `| x | ${','.repeat(50_000)}y |`])).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('is no table without the line of dashes under the names', () => {
    expect(speakTable(['| a | b |', '| c | d |'])).toBeNull();
  });
});

describe('speakMarkdownTables', () => {
  it('turns a table inside a message into sentences and keeps the rest', () => {
    expect(speakMarkdownTables(['Oto wyniki:', '', ...RESULTS, '', 'Koniec.'].join('\n'))).toBe([
      'Oto wyniki:',
      '',
      'Claude: Wersja i model 2.1.316, Haiku 5.5; Wynik 9 z 9 zaliczone.',
      '',
      '**Codex**: Wersja i model 0.166.0; Wynik 9 z 9 zaliczone.',
      '',
      'Koniec.',
    ].join('\n'));
  });

  it('turns a table without edge pipes into sentences and keeps a heading underline alone', () => {
    expect(speakMarkdownTables('Wyniki:\nAgent | Wynik\n---|---\nClaude | 9 z 9\n\nUżyj a | b\n---')).toBe(
      'Wyniki:\nClaude: Wynik 9 z 9.\n\nUżyj a | b\n---',
    );
  });

  it('leaves lines that only start with a pipe alone', () => {
    expect(speakMarkdownTables('| to nie jest tabela\nzwykły tekst')).toBe('| to nie jest tabela\nzwykły tekst');
  });
});
