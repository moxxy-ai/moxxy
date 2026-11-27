import { describe, expect, it } from 'vitest';
import { currentToolActivity } from './current-tool-activity';

describe('current tool activity', () => {
  it('keeps the filename even when the directory is long', () => {
    const directory = 'long-folder/'.repeat(12);
    expect(currentToolActivity('Read', { file_path: directory + 'report.md' })).toBe('Reading report.md');
    expect(currentToolActivity('Edit', { filePath: 'C:\\work\\notes.txt' })).toBe('Editing notes.txt');
  });

  it('uses a shell description or executable without printing shell arguments', () => {
    expect(currentToolActivity('Bash', { command: '/usr/bin/sysctl -n hw.ncpu' })).toBe('Running sysctl');
    expect(currentToolActivity('Bash', { command: 'pnpm test', description: 'Checking the desktop tests' })).toBe('Checking the desktop tests');
  });

  it('leaves arbitrary payloads in the details of an unrecognized tool', () => {
    expect(currentToolActivity('mcp__catalog__add_item', { description: 'Body entered by the user' })).toBe('Using add item');
  });
});
