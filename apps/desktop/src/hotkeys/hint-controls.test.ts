import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A control opts into the held-modifier hint with `data-hotkey` (or the
 * `hotkey` prop of a bar button), naming a binding of the keymap. A name the
 * keymap does not have would show nothing and say nothing, so it is checked
 * here against the keymap's source.
 */

const SRC = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/u.test(entry.name) && !/\.test\.tsx$/u.test(entry.name) ? [path] : [];
  });
}

const named = new Set(
  sources(SRC).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/\b(?:data-hotkey|hotkey)="([^"]+)"/gu)].map((match) => match[1] ?? ''),
  ),
);
const keymap = readFileSync(join(__dirname, 'useAppHotkeys.ts'), 'utf8');
const bound = new Set([...keymap.matchAll(/\bid: '([^']+)'/gu)].map((match) => match[1] ?? ''));

describe('controls that show their shortcut', () => {
  it('each name a shortcut the keymap binds', () => {
    for (const id of named) expect(bound, `no binding "${id}" in useAppHotkeys`).toContain(id);
  });

  it('are the ones someone new reaches for with the pointer', () => {
    expect([...named].sort()).toEqual([
      'chat.abort',
      'chat.focusComposer',
      'session.new',
      'view.sidebar',
      'view.workbench',
      'view.workbenchFull',
    ]);
  });
});
