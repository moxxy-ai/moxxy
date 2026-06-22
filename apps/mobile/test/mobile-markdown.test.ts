import { describe, expect, it } from 'vitest';
import { buildMobileMarkdownBlocks } from '../src/mobileMarkdown';

describe('mobile markdown model', () => {
  it('keeps desktop-compatible markdown blocks and inline links for rendering', () => {
    expect(buildMobileMarkdownBlocks([
      '## Sources',
      '- **FTMO**: [official site](https://ftmo.com)',
      '',
      '`code` and *italic*',
    ].join('\n'))).toEqual([
      { kind: 'heading', level: 2, text: 'Sources' },
      {
        kind: 'list',
        ordered: false,
        items: [
          [
            { kind: 'bold', value: 'FTMO' },
            { kind: 'text', value: ': ' },
            { kind: 'link', label: 'official site', url: 'https://ftmo.com' },
          ],
        ],
      },
      {
        kind: 'paragraph',
        inline: [
          { kind: 'code', value: 'code' },
          { kind: 'text', value: ' and ' },
          { kind: 'italic', value: 'italic' },
        ],
      },
    ]);
  });
});
