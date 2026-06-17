import { describe, expect, it } from 'vitest';
import { isToolDisplayResult, type FileDiffDisplay } from '@moxxy/sdk';
import { buildFileDiffDisplay } from './file-diff.js';

const cwd = '/repo';
const build = (before: string, after: string, mode: 'create' | 'update' = 'update'): FileDiffDisplay => {
  const r = buildFileDiffDisplay({ cwd, absPath: '/repo/src/a.ts', before, after, mode });
  expect(isToolDisplayResult(r)).toBe(true);
  return r.display as FileDiffDisplay;
};

describe('buildFileDiffDisplay', () => {
  it('counts added/removed for a single-line replacement', () => {
    const before = 'line1\nline2\nline3\nline4\nline5';
    const after = 'line1\nline2\nCHANGED\nline4\nline5';
    const d = build(before, after);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.hunks).toHaveLength(1);
    const kinds = d.hunks[0]!.lines.map((l) => l.kind);
    // ±2 context around the change → context, context, del, add, context, context
    expect(kinds).toEqual(['context', 'context', 'del', 'add', 'context', 'context']);
  });

  it('assigns gutter line numbers (del uses old, add uses new)', () => {
    const d = build('a\nb\nc\nd\ne', 'a\nb\nX\nd\ne');
    const del = d.hunks[0]!.lines.find((l) => l.kind === 'del')!;
    const add = d.hunks[0]!.lines.find((l) => l.kind === 'add')!;
    expect(del.oldNo).toBe(3);
    expect(add.newNo).toBe(3);
  });

  it('treats an empty before as create (all additions)', () => {
    const d = build('', 'a\nb\nc', 'create');
    expect(d.mode).toBe('create');
    expect(d.added).toBe(3);
    expect(d.removed).toBe(0);
    expect(d.hunks[0]!.lines.every((l) => l.kind === 'add')).toBe(true);
  });

  it('produces separate hunks for distant changes', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line${i + 1}`);
    const before = lines.join('\n');
    const after = lines.map((l, i) => (i === 2 ? 'TOP' : i === 35 ? 'BOTTOM' : l)).join('\n');
    const d = build(before, after);
    expect(d.hunks.length).toBe(2);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(2);
  });

  it('uses the relative display path but keeps the absolute path for the model', () => {
    const r = buildFileDiffDisplay({ cwd, absPath: '/repo/src/a.ts', before: 'x', after: 'y', mode: 'update' });
    expect((r.display as FileDiffDisplay).path).toBe('src/a.ts');
    expect(r.forModel).toContain('/repo/src/a.ts');
  });

  it('truncates a pathologically large diff but still reports full counts', () => {
    const before = '';
    const after = Array.from({ length: 5000 }, (_, i) => `l${i}`).join('\n');
    const d = build(before, after, 'create');
    expect(d.added).toBe(5000);
    expect(d.truncated).toBe(true);
    const emitted = d.hunks.reduce((n, h) => n + h.lines.length, 0);
    expect(emitted).toBeLessThanOrEqual(400);
  });

  it('no-op edit yields no hunks', () => {
    const d = build('same\ncontent', 'same\ncontent');
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.hunks).toHaveLength(0);
  });
});
