import { describe, expect, it } from 'vitest';
import { contextualToolCaption, currentToolActivity } from './current-tool-activity';

describe('current tool activity', () => {
  it('names the file or app, in the right tense, without exposing typed text or the parent directory', () => {
    expect(contextualToolCaption('Read', { file_path: '/private/folder/notes.md' }, true)).toBe('Read notes.md');
    expect(contextualToolCaption('mcp__moxxy__computer_type_text', { app: 'Notes', text: 'private' }, false)).toBe('Typing in Notes');
    expect(contextualToolCaption('computer_get_app_state', { app: 'Calendar' }, true)).toBe('Checked Calendar');
    expect(contextualToolCaption('browser_tabs', { action: 'list' }, true)).toBe('Reviewed open tabs');
  });
  it('keeps the filename even when the directory is long', () => {
    const directory = 'long-folder/'.repeat(12);
    expect(currentToolActivity('Read', { file_path: directory + 'report.md' })).toBe('Reading report.md');
    expect(currentToolActivity('Edit', { filePath: 'C:\\work\\notes.txt' })).toBe('Editing notes.txt');
  });

  it('uses a shell description or executable without printing shell arguments', () => {
    expect(currentToolActivity('Bash', { command: '/usr/bin/sysctl -n hw.ncpu' })).toBe('Running sysctl');
    expect(currentToolActivity('Bash', { command: 'pnpm test', description: 'Checking the desktop tests' })).toBe('Checking the desktop tests');
  });

  it('describes browser activity before the registry is ready without exposing the raw command', () => {
    expect(currentToolActivity('browser_snapshot', {})).toBe('Reading the page');
    expect(currentToolActivity('mcp__moxxy__browser_click', { uid: '33' })).toBe('Clicking an element');
    expect(currentToolActivity('browser_session', { expression: 'document.body' })).toBe('Working in the browser');
  });

  it('leaves arbitrary payloads in the details of an unrecognized tool', () => {
    expect(currentToolActivity('mcp__catalog__add_item', { description: 'Body entered by the user' })).toBe('Using add item');
  });
});
