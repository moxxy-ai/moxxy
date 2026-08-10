import { describe, expect, it } from 'vitest';
import { terminalSafeText } from './terminal-text.js';

describe('terminalSafeText', () => {
  it('removes terminal controls and caps untrusted labels', () => {
    expect(terminalSafeText('safe\u001b[31m\u0007\u009b31m', 40)).toBe('safe[31m31m');
    expect(terminalSafeText('abcdef', 4)).toBe('abc…');
  });

  it('preserves newlines only for explicitly multiline content', () => {
    expect(terminalSafeText('a\nb', 20)).toBe('ab');
    expect(terminalSafeText('a\nb', 20, { multiline: true })).toBe('a\nb');
  });
});
