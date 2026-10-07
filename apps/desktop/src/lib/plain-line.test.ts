import { describe, expect, it } from 'vitest';
import { plainLine } from './plain-line';

describe('plainLine', () => {
  it('collapses whitespace into one line', () => {
    expect(plainLine('  one\n\n two\tthree ')).toBe('one two three');
  });

  it('drops Markdown marks and keeps the words', () => {
    expect(plainLine('## Plan\n- **Keep** the `log`\n> quoted')).toBe('Plan Keep the log quoted');
  });

  it('leaves out fenced code', () => {
    expect(plainLine('Run this:\n```sh\npnpm build\n```\nthen stop')).toBe('Run this: then stop');
  });
});
