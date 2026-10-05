import { describe, expect, it } from 'vitest';
import { findRows, MAX_FOUND } from './find.js';

/**
 * Finding one thing on a large page without reading the page.
 *
 * To reach the n8n card in Coolify's catalogue the agent read the whole
 * catalogue: 178,073 characters. Asked for "n8n", the same page answers with a
 * handful of rows, each with the uid to act on.
 */
const page = [
  '[1] RootWebArea: "Coolify"',
  '  [2] textbox: "Type / to search..."',
  '  [3] heading: "N8N"',
  '  [4] link: "N8N With Postgresql"',
  '  [5] link: "Ghost"',
  '  [6] LabelText',
  '    [7] StaticText: "Domains"',
  '  [8] textbox: "http://n8n-abc.sslip.io"',
  '  [9] LabelText',
  '    [10] StaticText: "Description"',
  '  [11] textbox',
].join('\n');

describe('findRows', () => {
  it('gives the rows that mention what was asked for, whatever the case', () => {
    const out = findRows(page, 'n8n');

    expect(out.rows).toEqual(['[3] heading: "N8N"', '[4] link: "N8N With Postgresql"', '[8] textbox: "http://n8n-abc.sslip.io"']);
    expect(out.total).toBe(3);
  });

  it('matches every word of the query, in any order, so a role can narrow it', () => {
    expect(findRows(page, 'postgresql link').rows).toEqual(['[4] link: "N8N With Postgresql"']);
  });

  it('brings the field that follows a label, since the label is what the page calls it', () => {
    // Coolify's settings put "Domains" before a textbox the label is not tied
    // to; the field itself is named by its current value or not at all.
    const out = findRows(page, 'Domains');

    expect(out.rows).toEqual(['[7] StaticText: "Domains"', '  → field: [8] textbox: "http://n8n-abc.sslip.io"']);
  });

  it('brings a field with no name at all after its label', () => {
    expect(findRows(page, 'description').rows).toEqual(['[10] StaticText: "Description"', '  → field: [11] textbox']);
  });

  it('stops at a limit and says how many there were', () => {
    const many = Array.from({ length: 50 }, (_, i) => `[${i + 1}] link: "Item ${i + 1}"`).join('\n');

    const out = findRows(many, 'item');

    expect(out.rows).toHaveLength(MAX_FOUND);
    expect(out.total).toBe(50);
  });

  it('finds nothing in a row without a uid, and nothing for an empty query', () => {
    expect(findRows('… 30 more rows not shown', 'rows').rows).toEqual([]);
    expect(findRows(page, '   ').rows).toEqual([]);
  });
});
