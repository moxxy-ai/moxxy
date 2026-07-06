import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FileDiffDisplay } from '@moxxy/sdk';
import { assertDefined } from '@moxxy/sdk';
import { FileDiffView } from './render-diff.js';

const render = (display: FileDiffDisplay): string => renderToStaticMarkup(createElement(FileDiffView, { display }));

const baseDisplay: FileDiffDisplay = {
  kind: 'file-diff',
  path: 'src/foo.ts',
  mode: 'update',
  added: 2,
  removed: 1,
  hunks: [
    {
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
      lines: [
        { kind: 'context', text: 'keep me', oldNo: 1, newNo: 1 },
        { kind: 'del', text: 'old line', oldNo: 2 },
        { kind: 'add', text: 'new line', newNo: 2 },
        { kind: 'add', text: 'extra line', newNo: 3 },
      ],
    },
  ],
};

describe('FileDiffView', () => {
  it('renders an Update header with the path and a +/- summary', () => {
    const html = render(baseDisplay);
    expect(html).toContain('Update · src/foo.ts');
    expect(html).toContain('+2 −1');
  });

  it('uses Create for new files', () => {
    const html = render({ ...baseDisplay, mode: 'create' });
    expect(html).toContain('Create · src/foo.ts');
  });

  it('applies add/del backgrounds and dim context classes with markers', () => {
    const html = render(baseDisplay);
    expect(html).toContain('v-diff-add');
    expect(html).toContain('v-diff-del');
    expect(html).toContain('v-diff-ctx');
    expect(html).toContain('new line');
    expect(html).toContain('old line');
  });

  it('shows gutter numbers (new for add/context, old for deletions)', () => {
    const html = render(baseDisplay);
    // del shows old number 2; first add shows new number 2; context shows 1.
    expect(html).toMatch(/v-diff-no[^>]*>1</);
    expect(html).toMatch(/v-diff-no[^>]*>2</);
    expect(html).toMatch(/v-diff-no[^>]*>3</);
  });

  it('inserts a ⋯ gap row between non-contiguous hunks', () => {
    const hunk = baseDisplay.hunks[0];
    assertDefined(hunk, 'baseDisplay has a hunk');
    const twoHunks: FileDiffDisplay = {
      ...baseDisplay,
      hunks: [
        hunk,
        { oldStart: 40, oldLines: 1, newStart: 41, newLines: 1, lines: [{ kind: 'context', text: 'far away', oldNo: 40, newNo: 41 }] },
      ],
    };
    const html = render(twoHunks);
    expect(html).toContain('v-diff-gap');
    expect(html).toContain('⋯');
  });

  it('renders a truncation notice when truncated', () => {
    const html = render({ ...baseDisplay, truncated: true });
    expect(html).toContain('diff truncated');
  });

  it('keeps the compact "+X −Y" count glyph (not the prose fileDiffSummary form)', () => {
    // The dedup pulls rowsOf/gutter/verb from @moxxy/sdk/tool-display but
    // deliberately keeps the local plusMinus: the shared fileDiffSummary
    // renders "Added N lines, removed M line", which this header must NOT use.
    const html = render(baseDisplay);
    expect(html).toContain('+2 −1');
    expect(html).not.toContain('Added 2 lines');
  });
});
