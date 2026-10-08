import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A voice conversation makes no sound while Moxxy thinks: the card shows the
 * work, and the only thing heard is the answer.
 */

describe('Voice Mode on the desktop', () => {
  it('ships no audio of its own', () => {
    const audio = readdirSync(__dirname, { recursive: true, encoding: 'utf8' }).filter((name) =>
      /\.(?:ogg|mp3|wav|m4a)$/u.test(name),
    );

    expect(audio).toEqual([]);
  });
});
