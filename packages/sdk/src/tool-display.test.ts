import { describe, expect, it } from 'vitest';
import {
  diffGutterNo,
  fileDiffSummary,
  fileDiffVerb,
  imageToolOutput,
  isFileDiffDisplay,
  isQuestionAnswerDisplay,
  isToolDisplayResult,
  questionAnswerLines,
  toDiffRows,
  toolImagesOf,
  type QuestionAnswerDisplay,
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

describe('question-answer display', () => {
  const answered: QuestionAnswerDisplay = {
    kind: 'question-answer',
    questions: [
      { header: 'Colour', question: 'Which colour?', chosen: ['Blue'] },
      { question: 'Which parts?', chosen: ['Auth', 'Billing'], own: 'and the admin' },
    ],
  };

  it('is a tool display, so the model is shown only the text and the transcript the answers', () => {
    expect(isQuestionAnswerDisplay(answered)).toBe(true);
    expect(isToolDisplayResult({ forModel: 'The user answered: …', display: answered })).toBe(true);
  });

  it('rejects a malformed payload instead of rendering it', () => {
    expect(isQuestionAnswerDisplay({ kind: 'question-answer' })).toBe(false);
    expect(isQuestionAnswerDisplay({ kind: 'question-answer', questions: [{ question: 'Q?' }] })).toBe(false);
    expect(isQuestionAnswerDisplay({ kind: 'question-answer', questions: [{ question: 'Q?', chosen: [1] }] })).toBe(false);
  });

  it('reads as one line per question for text surfaces', () => {
    expect(questionAnswerLines(answered)).toEqual([
      'Colour: Which colour? → Blue',
      'Which parts? → Auth, Billing; own answer: and the admin',
    ]);
  });
});

describe('images in a tool result', () => {
  it('are read from the shape Moxxy tools return, with the text beside it', () => {
    expect(toolImagesOf({ mediaType: 'image/png', base64: 'AAA', forModel: 'Screenshot of Arc' })).toEqual({
      images: [{ mediaType: 'image/png', base64: 'AAA' }],
      text: 'Screenshot of Arc',
    });
  });

  it('are read from the provider-native image block too', () => {
    expect(toolImagesOf({ type: 'image', mediaType: 'image/jpeg', data: 'BBB' })).toEqual({
      images: [{ mediaType: 'image/jpeg', base64: 'BBB' }],
      text: '',
    });
  });

  it('are nothing for text, a file diff, or an object without pixels', () => {
    expect(toolImagesOf('plain text')).toBeNull();
    expect(toolImagesOf({ mediaType: 'image/png' })).toBeNull();
    expect(toolImagesOf(null)).toBeNull();
  });

  it('are what an agent connection hands over: the text the agent read and every image, in order', () => {
    const shots = [
      { mediaType: 'image/jpeg', base64: 'ONE' },
      { mediaType: 'image/png', base64: 'TWO' },
      { mediaType: 'image/jpeg', base64: 'THREE' },
    ];

    expect(toolImagesOf(imageToolOutput('Took three screenshots.', shots))).toEqual({ images: shots, text: 'Took three screenshots.' });
  });

  it('keep one copy of an image sent twice, as Codex sends each screenshot', () => {
    const shot = { mediaType: 'image/jpeg', base64: 'SAME' };
    const other = { mediaType: 'image/jpeg', base64: 'OTHER' };

    expect(imageToolOutput('', [shot, shot, other, shot])).toEqual({ forModel: '', mediaType: 'image/jpeg', base64: 'SAME', moreImages: [other] });
    expect(imageToolOutput('', [shot, shot])).toEqual({ forModel: '', mediaType: 'image/jpeg', base64: 'SAME' });
  });
});
