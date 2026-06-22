import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse-blocks.js';

describe('parseBlocks — GFM tables', () => {
  it('recognizes a single-column table (`|---|`)', () => {
    const md = ['| Item |', '|------|', '| a |', '| b |'].join('\n');
    const blocks = parseBlocks(md);
    const table = blocks.find((b) => b.kind === 'table');
    expect(table).toBeDefined();
    expect(table).toMatchObject({
      kind: 'table',
      header: ['Item'],
      rows: [['a'], ['b']],
    });
  });

  it('still recognizes a multi-column table', () => {
    const md = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
    const table = parseBlocks(md).find((b) => b.kind === 'table');
    expect(table).toMatchObject({ kind: 'table', header: ['A', 'B'], rows: [['1', '2']] });
  });

  it('does NOT treat a bare `---` horizontal rule as a one-column separator', () => {
    // No pipe → not a table; the paragraph + rule must not fold into a table.
    const md = ['Heading text', '---', 'body'].join('\n');
    const blocks = parseBlocks(md);
    expect(blocks.some((b) => b.kind === 'table')).toBe(false);
  });
});
