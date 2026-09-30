import { describe, expect, it } from 'vitest';
import { appTreeSchema, diffTrees, formatTree, type AppTree } from './tree.js';

const tree = (elements: AppTree['elements']): AppTree => ({ app: 'TextEdit', window: 'Untitled', elements });

const base = tree([
  { key: 'w', index: 0, depth: 0, role: 'window', title: 'Untitled' },
  { key: 'w/close', index: 1, depth: 1, role: 'button', title: 'Close', actions: ['AXPress'] },
  { key: 'w/text', index: 2, depth: 1, role: 'text area', value: 'hello', states: ['focused'] },
  { key: 'w/format', index: 3, depth: 1, role: 'pop up button', title: 'Format', actions: ['AXShowMenu'] },
]);

describe('formatTree', () => {
  it('prints one indexed, indented line per element', () => {
    expect(formatTree(base)).toBe([
      'App: TextEdit — window "Untitled"',
      '[0] window "Untitled"',
      '  [1] button "Close" actions=[AXPress]',
      '  [2] text area value="hello" focused',
      '  [3] pop up button "Format" actions=[AXShowMenu]',
    ].join('\n'));
  });

  it('never prints the value of a secure field', () => {
    const text = formatTree(tree([{ key: 'p', index: 0, depth: 0, role: 'secure text field', value: 'hunter2', secure: true }]));
    expect(text).not.toContain('hunter2');
    expect(text).toContain('value=<secure>');
  });

  it('escapes quotes and newlines and caps long values', () => {
    const text = formatTree(tree([{ key: 'v', index: 0, depth: 0, role: 'text', value: `say "hi"\n${'x'.repeat(1000)}` }]));
    expect(text).toContain(String.raw`value="say \"hi\"\n`);
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(600);
  });

  it('notes a truncated tree', () => {
    expect(formatTree({ ...base, truncated: true })).toMatch(/truncated/);
  });
});

describe('diffTrees', () => {
  it('reports no change for an identical tree', () => {
    expect(diffTrees(base, base)).toEqual({ kind: 'unchanged', text: expect.stringMatching(/No changes/) });
  });

  it('lists added, removed and changed elements only', () => {
    const next = tree([
      base.elements[0],
      base.elements[1],
      { ...base.elements[2], value: 'hello world' },
      base.elements[3],
      { key: 'w/sheet', index: 4, depth: 1, role: 'sheet', title: 'Save' },
    ].filter((element) => element.key !== 'w/close'));
    const diff = diffTrees(base, next);
    expect(diff.kind).toBe('diff');
    expect(diff.text).toContain('+ [4] sheet "Save"');
    expect(diff.text).toContain('~ [2] text area value="hello world" focused');
    expect(diff.text).toContain('- button "Close"');
    expect(diff.text).not.toContain('Format');
  });

  it('reports an unchanged element whose index moved, so no old index is reused', () => {
    const next = tree(base.elements.map((element) => element.key === 'w/format' ? { ...element, index: 7 } : element));
    expect(diffTrees(base, next).text).toContain('~ [7] pop up button "Format"');
  });

  it('falls back to the full tree when most of it changed', () => {
    const next = tree([{ key: 'other', index: 9, depth: 0, role: 'window', title: 'Other' }]);
    expect(diffTrees(base, next)).toEqual({ kind: 'full', text: formatTree(next) });
  });

  it('returns the full tree when there is nothing to compare with or the window changed', () => {
    expect(diffTrees(undefined, base)).toEqual({ kind: 'full', text: formatTree(base) });
    const other = { ...base, window: 'Other' };
    expect(diffTrees(base, other)).toEqual({ kind: 'full', text: formatTree(other) });
  });
});

describe('appTreeSchema', () => {
  it('rejects duplicate indices or keys from a helper', () => {
    const duplicated = { ...base, elements: [...base.elements, { ...base.elements[1], key: 'x' }] };
    expect(() => appTreeSchema.parse(duplicated)).toThrow(/index/);
    const sameKey = { ...base, elements: [...base.elements, { ...base.elements[1], index: 9 }] };
    expect(() => appTreeSchema.parse(sameKey)).toThrow(/key/);
  });
});
