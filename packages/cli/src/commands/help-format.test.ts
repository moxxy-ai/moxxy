import { describe, expect, it } from 'vitest';
import { formatHelp, wrapHelpText } from './help-format.js';

describe('help formatting', () => {
  it('keeps command help inside a narrow terminal', () => {
    const output = formatHelp(
      {
        title: 'moxxy extensions',
        tagline: 'Manage optional capabilities without crowding the everyday workflow.',
        sections: [
          {
            title: 'COMMANDS',
            rows: [
              ['install <package>', 'Install an extension package and make it available here.'],
              ['disable <package>', 'Keep it installed but remove it from the active workspace.'],
            ],
          },
        ],
      },
      40,
    );

    expect(output.split('\n').every((line) => line.length <= 40)).toBe(true);
  });

  it('splits a single token that exceeds the available width', () => {
    expect(wrapHelpText('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
  });
});
