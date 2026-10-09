import { describe, expect, it } from 'vitest';
import { toolCallText } from './tool-call-text';

/**
 * What a tool is about to do, written out for the person asked to allow it.
 * Nothing is shortened: an approval of text you cannot read is not one.
 */

describe('toolCallText', () => {
  it('shows a command whole, however long', () => {
    const command = `pnpm --filter @moxxy/desktop test -- --run ${'src/chat '.repeat(40)}`.trim();
    expect(toolCallText({ command })).toBe(command);
  });

  it('keeps the lines of a script as lines', () => {
    expect(toolCallText({ command: 'cd /tmp\nrm -rf build' })).toBe('cd /tmp\nrm -rf build');
  });

  it('names each argument when there are several', () => {
    expect(toolCallText({ file_path: 'src/a.ts', old_string: 'a', new_string: 'b', replace_all: true })).toBe(
      'file_path: src/a.ts\nold_string: a\nnew_string: b\nreplace_all: true',
    );
  });

  it('sets a value of several lines under its name', () => {
    expect(toolCallText({ file_path: 'a.md', content: '# Title\n\nBody' })).toBe(
      'file_path: a.md\ncontent:\n  # Title\n  \n  Body',
    );
  });

  it('writes a nested value as JSON', () => {
    expect(toolCallText({ url: 'https://example.test', headers: { accept: 'text/html' } })).toBe(
      'url: https://example.test\nheaders: {"accept":"text/html"}',
    );
  });

  it('has nothing to show for a call with no arguments', () => {
    expect(toolCallText({})).toBe('');
    expect(toolCallText(undefined)).toBe('');
    expect(toolCallText('plain')).toBe('plain');
  });
});
