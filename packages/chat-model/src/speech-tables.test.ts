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

  it('leaves lines that only start with a pipe alone', () => {
    expect(speakMarkdownTables('| to nie jest tabela\nzwykły tekst')).toBe('| to nie jest tabela\nzwykły tekst');
  });
});
