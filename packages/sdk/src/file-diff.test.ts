/** A file change shown as a diff, whether Moxxy made it or an agent reported its own. */
import { describe, expect, it } from 'vitest';
import { diffPathIn, fileDiffFromPatch, fileDiffFromText, parseUnifiedDiff } from './file-diff.js';

describe('a diff from the text before and after', () => {
  it('shows the changed lines with two lines of context and their numbers', () => {
    const d = fileDiffFromText({ path: 'a.ts', mode: 'update', before: 'a\nb\nc\nd\ne\nf\ng', after: 'a\nb\nc\nX\ne\nf\ng' });

    expect(d).toMatchObject({ kind: 'file-diff', path: 'a.ts', mode: 'update', added: 1, removed: 1 });
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0]?.lines).toEqual([
      { kind: 'context', text: 'b', oldNo: 2, newNo: 2 },
      { kind: 'context', text: 'c', oldNo: 3, newNo: 3 },
      { kind: 'del', text: 'd', oldNo: 4 },
      { kind: 'add', text: 'X', newNo: 4 },
      { kind: 'context', text: 'e', oldNo: 5, newNo: 5 },
      { kind: 'context', text: 'f', oldNo: 6, newNo: 6 },
    ]);
  });

  it('shows a new file as all added', () => {
    const d = fileDiffFromText({ path: 'new.ts', mode: 'create', before: '', after: 'one\ntwo\n' });

    expect(d).toMatchObject({ mode: 'create', added: 2, removed: 0 });
    expect(d.hunks[0]?.lines.map((line) => line.kind)).toEqual(['add', 'add']);
  });
});

describe('a diff from patch hunks an agent reports', () => {
  it('numbers the lines of each hunk from where it starts', () => {
    const d = fileDiffFromPatch({
      path: 'src/db.ts',
      mode: 'update',
      hunks: [{ oldStart: 10, newStart: 10, lines: [' const host = "x";', '-const port = 5432;', '+const port = 5433;', '+const pool = 4;'] }],
    });

    expect(d).toMatchObject({ added: 2, removed: 1 });
    expect(d.hunks).toEqual([
      {
        oldStart: 10,
        oldLines: 2,
        newStart: 10,
        newLines: 3,
        lines: [
          { kind: 'context', text: 'const host = "x";', oldNo: 10, newNo: 10 },
          { kind: 'del', text: 'const port = 5432;', oldNo: 11 },
          { kind: 'add', text: 'const port = 5433;', newNo: 11 },
          { kind: 'add', text: 'const pool = 4;', newNo: 12 },
        ],
      },
    ]);
  });

  it('skips the "no newline at end of file" marker', () => {
    const d = fileDiffFromPatch({ path: 'a', mode: 'update', hunks: [{ oldStart: 1, newStart: 1, lines: ['-a', '\\ No newline at end of file', '+b'] }] });

    expect(d.hunks[0]?.lines.map((line) => line.text)).toEqual(['a', 'b']);
  });

  it('caps what it shows on a huge patch but counts every line', () => {
    const lines = Array.from({ length: 1_000 }, (_, i) => `+line ${i}`);
    const d = fileDiffFromPatch({ path: 'big', mode: 'create', hunks: [{ oldStart: 0, newStart: 1, lines }] });

    expect(d.added).toBe(1_000);
    expect(d.truncated).toBe(true);
    expect(d.hunks[0]?.lines.length).toBeLessThan(1_000);
  });
});

describe('reading a unified diff', () => {
  it('reads each hunk and leaves out the file headers', () => {
    const text = '--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more\n@@ -20,3 +21,3 @@ function f() {\n a\n-b\n+c\n d\n';

    expect(parseUnifiedDiff(text)).toEqual([
      { oldStart: 1, newStart: 1, lines: ['-old', '+new', '+more'] },
      { oldStart: 20, newStart: 21, lines: [' a', '-b', '+c', ' d'] },
    ]);
  });

  it('finds no hunks in text that is not a diff', () => {
    expect(parseUnifiedDiff('just some file content')).toEqual([]);
  });
});

describe('the path a diff shows', () => {
  it('is relative to the project folder when the file is inside it', () => {
    expect(diffPathIn('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(diffPathIn('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src\\a.ts');
  });

  it('stays as given outside the project folder', () => {
    expect(diffPathIn('/repo', '/repository/a.ts')).toBe('/repository/a.ts');
    expect(diffPathIn('/repo', 'src/a.ts')).toBe('src/a.ts');
  });
  it('ignores trailing separators on the project folder, in time linear in its length', () => {
    expect(diffPathIn('/repo//', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(diffPathIn('C:\\repo\\', 'C:\\repo\\a.ts')).toBe('a.ts');

    const started = performance.now();
    diffPathIn(`${'/'.repeat(100_000)}x`, '/a.ts');
    expect(performance.now() - started).toBeLessThan(500);
  });
});
