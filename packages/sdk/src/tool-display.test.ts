import { describe, expect, it } from 'vitest';
import {
  diffGutterNo,
  fileDiffSummary,
  fileDiffVerb,
  isFileDiffDisplay,
  isToolDisplayResult,
  toDiffRows,
  type FileDiffDisplay,
} from './tool-display.js';

const diff = (over: Partial<FileDiffDisplay> = {}): FileDiffDisplay => ({
  kind: 'file-diff',
  path: 'src/a.ts',
  mode: 'update',
  added: 10,
  removed: 1,
  hunks: [],
  ...over,
});

describe('fileDiffSummary', () => {
  it('pluralizes and joins', () => {
    expect(fileDiffSummary(diff())).toBe('Added 10 lines, removed 1 line');
  });
  it('handles add-only / remove-only', () => {
    expect(fileDiffSummary(diff({ removed: 0 }))).toBe('Added 10 lines');
    expect(fileDiffSummary(diff({ added: 0, removed: 3 }))).toBe('Removed 3 lines');
  });
  it('notes truncation', () => {
    expect(fileDiffSummary(diff({ truncated: true }))).toContain('truncated');
  });
});

describe('fileDiffVerb', () => {
  it('maps mode to verb', () => {
    expect(fileDiffVerb(diff({ mode: 'create' }))).toBe('Create');
    expect(fileDiffVerb(diff({ mode: 'update' }))).toBe('Update');
  });
});

describe('diffGutterNo', () => {
  it('uses old number for deletions, new otherwise', () => {
    expect(diffGutterNo({ kind: 'del', text: '', oldNo: 5, newNo: undefined })).toBe(5);
    expect(diffGutterNo({ kind: 'add', text: '', newNo: 7 })).toBe(7);
    expect(diffGutterNo({ kind: 'context', text: '', oldNo: 3, newNo: 4 })).toBe(4);
  });
});

describe('toDiffRows', () => {
  it('inserts a gap marker between hunks', () => {
    const d = diff({
      hunks: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ kind: 'context', text: 'a' }] },
        { oldStart: 9, oldLines: 1, newStart: 9, newLines: 1, lines: [{ kind: 'context', text: 'b' }] },
      ],
    });
    const rows = toDiffRows(d);
    expect(rows.map((r) => r.kind)).toEqual(['context', 'gap', 'context']);
  });
});

describe('guards', () => {
  it('isFileDiffDisplay / isToolDisplayResult', () => {
    expect(isFileDiffDisplay(diff())).toBe(true);
    expect(isFileDiffDisplay({ kind: 'other' })).toBe(false);
    expect(isToolDisplayResult({ forModel: 'x', display: diff() })).toBe(true);
    expect(isToolDisplayResult({ forModel: 'x' })).toBe(false);
    expect(isToolDisplayResult('wrote 12 chars')).toBe(false);
  });

  it('rejects malformed file-diff objects (not just the right `kind`)', () => {
    // Right kind, but the rest of the shape is bogus — must not be trusted as a
    // structured diff (channels would otherwise render garbage / the model loses
    // the real output).
    expect(isFileDiffDisplay({ kind: 'file-diff' })).toBe(false); // no path/counts/hunks
    expect(isFileDiffDisplay({ kind: 'file-diff', path: 1, added: 1, removed: 0, hunks: [] })).toBe(false); // path not a string
    expect(isFileDiffDisplay({ kind: 'file-diff', path: 'a', added: '1', removed: 0, hunks: [] })).toBe(false); // added not numeric
    expect(isFileDiffDisplay({ kind: 'file-diff', path: 'a', added: 1, removed: 0, hunks: 'nope' })).toBe(false); // hunks not an array
    expect(isFileDiffDisplay({ kind: 'file-diff', path: 'a', added: 1, removed: 0, hunks: [{ lines: 'x' }] })).toBe(false); // hunk.lines not an array
    expect(isFileDiffDisplay({ kind: 'file-diff', path: 'a', added: 1, removed: 0, hunks: [null] })).toBe(false); // bad hunk entry
    // A malformed display must also fail the wrapping ToolDisplayResult guard.
    expect(isToolDisplayResult({ forModel: 'x', display: { kind: 'file-diff' } })).toBe(false);
    // A well-formed hunk passes.
    expect(
      isFileDiffDisplay({
        kind: 'file-diff',
        path: 'a',
        added: 1,
        removed: 0,
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [] }],
      }),
    ).toBe(true);
  });
});
