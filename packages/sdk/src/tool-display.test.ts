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
});
