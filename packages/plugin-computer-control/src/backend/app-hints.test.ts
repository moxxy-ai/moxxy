import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatterFile, skillFrontmatterSchema } from '@moxxy/sdk';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appHintsDirectory, hintFor, loadAppHints } from './app-hints.js';

describe('app hints', () => {
  it('reads each hint file as the apps it is for and the text to show', () => {
    const directory = mkdtempSync(join(tmpdir(), 'moxxy-hints-'));
    try {
      writeFileSync(join(directory, 'notes.md'), '---\nname: computer-app-notes\ndescription: Notes\napps:\n  - com.apple.Notes\n  - Notes\n---\n\nUse the search field.\n');
      writeFileSync(join(directory, 'broken.md'), 'no frontmatter here');
      writeFileSync(join(directory, 'ignored.txt'), 'x');
      const hints = loadAppHints(directory);
      expect(hints).toEqual([{ apps: ['com.apple.notes', 'notes'], text: 'Use the search field.' }]);
      expect(hintFor(hints, { id: 'com.apple.Notes', name: 'Whatever' })).toBe('Use the search field.');
      expect(hintFor(hints, { id: 'x.y.z', name: 'NOTES' })).toBe('Use the search field.');
      expect(hintFor(hints, { id: 'com.apple.Notes.2', name: '' })).toBe('Use the search field.');
      expect(hintFor(hints, { id: 'x', name: 'Notes 2026' })).toBe('Use the search field.');
      expect(hintFor(hints, { id: 'com.apple.NotesHelper', name: 'Notesy' })).toBeUndefined();
      expect(hintFor(hints, { id: 'com.apple.TextEdit', name: 'TextEdit' })).toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('returns no hints for a directory that does not exist', () => {
    expect(loadAppHints(join(tmpdir(), 'moxxy-no-such-hints'))).toEqual([]);
  });

  it('ships hints for browsers, Finder, office suites, video editors, design tools and 3D tools', () => {
    const hints = loadAppHints();
    const text = (id: string) => hintFor(hints, { id, name: '' });
    expect(text('com.apple.Safari')).toMatch(/browser/i);
    expect(text('com.google.Chrome')).toMatch(/browser/i);
    expect(text('com.apple.finder')).toBeTruthy();
    expect(text('com.microsoft.Excel')).toBeTruthy();
    expect(text('com.apple.iWork.Pages')).toBeTruthy();
    expect(text('com.blackmagic-design.DaVinciResolve')).toMatch(/timeline/i);
    expect(text('com.apple.FinalCut')).toMatch(/timeline/i);
    expect(text('com.adobe.PremierePro.25')).toMatch(/timeline/i);
    expect(text('com.figma.Desktop')).toMatch(/canvas/i);
    expect(text('com.adobe.Photoshop')).toMatch(/canvas/i);
    expect(text('org.blenderfoundation.blender')).toMatch(/F3/);
    expect(hintFor(hints, { id: 'blender', name: 'Blender' })).toMatch(/F3/);
  });

  it('keeps every shipped hint a valid skill and short enough to show inline', () => {
    const files = readdirSync(appHintsDirectory).filter((file) => file.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const { frontmatter, body } = parseFrontmatterFile(readFileSync(join(appHintsDirectory, file), 'utf8'));
      expect(skillFrontmatterSchema.safeParse(frontmatter).success, file).toBe(true);
      expect((frontmatter as { apps?: unknown[] }).apps?.length ?? 0, file).toBeGreaterThan(0);
      expect(body.trim().length, file).toBeLessThanOrEqual(1500);
    }
  });
});
