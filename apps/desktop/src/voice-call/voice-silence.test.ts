import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A voice conversation makes no sound while Moxxy thinks: the card shows the
 * work, and the only thing heard is the answer.
 */

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

describe('Voice Mode on the desktop', () => {
  it('hands the call no tone to play while it waits', () => {
    for (const path of sources(__dirname)) {
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/waitingTone\s*:/u);
    }
  });

  it('ships no audio of its own', () => {
    const audio = readdirSync(__dirname, { recursive: true, encoding: 'utf8' }).filter((name) =>
      /\.(?:ogg|mp3|wav|m4a)$/u.test(name),
    );

    expect(audio).toEqual([]);
  });
});
