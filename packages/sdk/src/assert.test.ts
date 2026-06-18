import { describe, expect, it } from 'vitest';
import { assertNever } from './assert.js';

describe('assertNever', () => {
  it('throws with the offending value embedded', () => {
    // Cast through unknown: simulate an untyped caller defeating the never narrowing.
    expect(() => assertNever('surprise' as unknown as never)).toThrow(/surprise/);
  });

  it('uses a custom message when provided', () => {
    expect(() => assertNever(3 as unknown as never, 'bad kind')).toThrow('bad kind');
  });

  it('survives a value that cannot be JSON-stringified', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => assertNever(circular as unknown as never)).toThrow(/assertNever/);
  });

  it('narrows exhaustively at compile time', () => {
    type Shape = { kind: 'a' } | { kind: 'b' };
    const area = (s: Shape): string => {
      switch (s.kind) {
        case 'a':
          return 'a';
        case 'b':
          return 'b';
        default:
          return assertNever(s);
      }
    };
    expect(area({ kind: 'a' })).toBe('a');
    expect(area({ kind: 'b' })).toBe('b');
  });
});
