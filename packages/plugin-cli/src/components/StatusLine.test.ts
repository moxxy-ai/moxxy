import { describe, expect, it } from 'vitest';
import { formatContextRemaining } from './StatusLine.js';

describe('StatusLine product chrome', () => {
  it('keeps remaining context compact across terminal widths', () => {
    expect(formatContextRemaining(32_000, 200_000)).toBe('ctx 84% left');
    expect(formatContextRemaining(32_000, 200_000, true)).toBe('ctx 168.0k left');
    expect(formatContextRemaining(250_000, 200_000)).toBe('ctx 0% left');
    expect(formatContextRemaining(10_000, null)).toBe('ctx —');
  });
});
