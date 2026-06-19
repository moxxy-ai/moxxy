import { describe, expect, it } from 'vitest';
import { reducer, INITIAL, type State } from './reducer.js';

function mk(partial: Partial<State>): State {
  return { ...INITIAL, ...partial };
}

describe('prompt reducer — insert / newline', () => {
  it('inserts at mid-cursor and advances the cursor', () => {
    const out = reducer(mk({ buffer: 'ac', cursor: 1 }), { type: 'insert', text: 'b' });
    expect(out.buffer).toBe('abc');
    expect(out.cursor).toBe(2);
  });

  it('inserts multi-char text advancing cursor by its length', () => {
    const out = reducer(mk({ buffer: '', cursor: 0 }), { type: 'insert', text: 'hello' });
    expect(out).toMatchObject({ buffer: 'hello', cursor: 5 });
  });

  it('insert-newline strips a trailing backslash only at end-of-buffer when asked', () => {
    const atEnd = reducer(mk({ buffer: 'foo\\', cursor: 4 }), {
      type: 'insert-newline',
      stripBackslashAtEnd: true,
    });
    expect(atEnd).toMatchObject({ buffer: 'foo\n', cursor: 4 });
  });

  it('insert-newline does NOT strip a backslash mid-line', () => {
    const mid = reducer(mk({ buffer: 'foo\\bar', cursor: 3 }), {
      type: 'insert-newline',
      stripBackslashAtEnd: true,
    });
    // backslash preserved; newline inserted at cursor 3
    expect(mid).toMatchObject({ buffer: 'foo\n\\bar', cursor: 4 });
  });

  it('insert-newline leaves a trailing backslash when stripping disabled', () => {
    const out = reducer(mk({ buffer: 'foo\\', cursor: 4 }), {
      type: 'insert-newline',
      stripBackslashAtEnd: false,
    });
    expect(out).toMatchObject({ buffer: 'foo\\\n', cursor: 5 });
  });
});

describe('prompt reducer — delete', () => {
  it('delete-back at cursor 0 is a no-op (returns same state)', () => {
    const s = mk({ buffer: 'abc', cursor: 0 });
    expect(reducer(s, { type: 'delete-back' })).toBe(s);
  });

  it('delete-back removes the char before the cursor', () => {
    expect(reducer(mk({ buffer: 'abc', cursor: 2 }), { type: 'delete-back' })).toMatchObject({
      buffer: 'ac',
      cursor: 1,
    });
  });

  it('delete-forward at end is a no-op', () => {
    const s = mk({ buffer: 'abc', cursor: 3 });
    expect(reducer(s, { type: 'delete-forward' })).toBe(s);
  });

  it('delete-forward removes the char at the cursor (cursor unchanged)', () => {
    expect(reducer(mk({ buffer: 'abc', cursor: 1 }), { type: 'delete-forward' })).toMatchObject({
      buffer: 'ac',
      cursor: 1,
    });
  });

  it('delete-word-back kills the previous word into the kill buffer', () => {
    const out = reducer(mk({ buffer: 'foo bar', cursor: 7 }), { type: 'delete-word-back' });
    expect(out.buffer).toBe('foo ');
    expect(out.cursor).toBe(4);
    expect(out.killBuffer).toBe('bar');
  });
});

describe('prompt reducer — cursor + word motion', () => {
  it('cursor-left/right clamp at the bounds', () => {
    expect(reducer(mk({ buffer: 'ab', cursor: 0 }), { type: 'cursor-left' }).cursor).toBe(0);
    expect(reducer(mk({ buffer: 'ab', cursor: 2 }), { type: 'cursor-right' }).cursor).toBe(2);
  });

  it('word-back skips trailing non-word chars then the word', () => {
    // cursor after "foo, " → lands at start of "foo"
    expect(reducer(mk({ buffer: 'foo, ', cursor: 5 }), { type: 'word-back' }).cursor).toBe(0);
  });

  it('word-forward skips leading non-word chars then the word', () => {
    expect(reducer(mk({ buffer: '  foo bar', cursor: 0 }), { type: 'word-forward' }).cursor).toBe(5);
  });

  it('word motion treats punctuation as a boundary', () => {
    // from index 0 of "a.b": skip word "a" → stop before the dot
    expect(reducer(mk({ buffer: 'a.b', cursor: 0 }), { type: 'word-forward' }).cursor).toBe(1);
  });
});

describe('prompt reducer — line nav + kill/yank', () => {
  const multi = 'line1\nline2\nline3';
  it('line-start/line-end stop at newline boundaries', () => {
    // cursor inside "line2" (index 8)
    expect(reducer(mk({ buffer: multi, cursor: 8 }), { type: 'line-start' }).cursor).toBe(6);
    expect(reducer(mk({ buffer: multi, cursor: 8 }), { type: 'line-end' }).cursor).toBe(11);
  });

  it('kill-to-line-end captures to the kill buffer, cursor unchanged', () => {
    const out = reducer(mk({ buffer: multi, cursor: 6 }), { type: 'kill-to-line-end' });
    expect(out.buffer).toBe('line1\n\nline3');
    expect(out.cursor).toBe(6);
    expect(out.killBuffer).toBe('line2');
  });

  it('kill-to-line-start captures to the kill buffer and moves cursor to line start', () => {
    const out = reducer(mk({ buffer: multi, cursor: 11 }), { type: 'kill-to-line-start' });
    expect(out.buffer).toBe('line1\n\nline3');
    expect(out.cursor).toBe(6);
    expect(out.killBuffer).toBe('line2');
  });

  it('kill then yank round-trips the killed text at the new cursor', () => {
    const killed = reducer(mk({ buffer: 'hello world', cursor: 5 }), { type: 'kill-to-line-end' });
    expect(killed.buffer).toBe('hello');
    expect(killed.killBuffer).toBe(' world');
    const yanked = reducer(killed, { type: 'yank' });
    expect(yanked.buffer).toBe('hello world');
    expect(yanked.cursor).toBe(11);
  });

  it('yank with an empty kill buffer is a no-op', () => {
    const s = mk({ buffer: 'abc', cursor: 1, killBuffer: '' });
    expect(reducer(s, { type: 'yank' })).toBe(s);
  });
});

describe('prompt reducer — reset / set / paste', () => {
  it('reset clears buffer + cursor but preserves the kill buffer', () => {
    const out = reducer(mk({ buffer: 'abc', cursor: 2, killBuffer: 'keep' }), { type: 'reset' });
    expect(out).toMatchObject({ buffer: '', cursor: 0, killBuffer: 'keep' });
  });

  it('set clamps the cursor into [0, buffer.length]', () => {
    expect(reducer(INITIAL, { type: 'set', buffer: 'abc', cursor: 99 })).toMatchObject({
      buffer: 'abc',
      cursor: 3,
    });
    expect(reducer(INITIAL, { type: 'set', buffer: 'abc', cursor: -5 })).toMatchObject({
      buffer: 'abc',
      cursor: 0,
    });
  });

  it('paste-start → paste-append* → paste-end accumulates then inserts at cursor', () => {
    let s = mk({ buffer: 'XY', cursor: 1 });
    s = reducer(s, { type: 'paste-start' });
    expect(s).toMatchObject({ inPaste: true, pasteBuffer: '' });
    s = reducer(s, { type: 'paste-append', data: 'ab' });
    s = reducer(s, { type: 'paste-append', data: 'cd' });
    expect(s.pasteBuffer).toBe('abcd');
    s = reducer(s, { type: 'paste-end' });
    expect(s).toMatchObject({ buffer: 'XabcdY', cursor: 5, inPaste: false, pasteBuffer: '' });
  });

  it('paste-end overrideText wins over the accumulated paste buffer', () => {
    let s = mk({ buffer: 'XY', cursor: 1 });
    s = reducer(s, { type: 'paste-start' });
    s = reducer(s, { type: 'paste-append', data: 'ignored' });
    s = reducer(s, { type: 'paste-end', overrideText: 'Z' });
    expect(s).toMatchObject({ buffer: 'XZY', cursor: 2, pasteBuffer: '' });
  });

  it('paste-end with empty overrideText inserts nothing and clears inPaste', () => {
    // This is the mechanism PromptInput uses to DRAIN a paste that was
    // stranded by `disabled` flipping mid-paste: the end marker must clear
    // `inPaste` (so later keystrokes are not swallowed) without inserting the
    // dropped-during-turn payload.
    let s = mk({ buffer: 'XY', cursor: 1, inPaste: true, pasteBuffer: 'lots of pasted text' });
    s = reducer(s, { type: 'paste-end', overrideText: '' });
    expect(s).toMatchObject({ buffer: 'XY', cursor: 1, inPaste: false, pasteBuffer: '' });
  });
});
