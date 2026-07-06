import { describe, expect, it } from 'vitest';
import { assertDefined, assertNever, invariant } from './assert.js';

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

describe('invariant', () => {
  it('throws on falsy conditions with the message', () => {
    expect(() => invariant(false, 'session must be started')).toThrow(
      'Invariant violation: session must be started',
    );
    expect(() => invariant(undefined, 'x')).toThrow(/Invariant violation/);
    expect(() => invariant(0, 'x')).toThrow(/Invariant violation/);
    expect(() => invariant('', 'x')).toThrow(/Invariant violation/);
  });

  it('passes on truthy conditions', () => {
    expect(() => invariant(true, 'x')).not.toThrow();
    expect(() => invariant(1, 'x')).not.toThrow();
    expect(() => invariant('ok', 'x')).not.toThrow();
  });

  it('narrows the condition type', () => {
    const maybe: string | undefined = Math.abs(1) === 1 ? 'value' : undefined;
    invariant(maybe, 'maybe is set');
    // After the invariant, `maybe` is `string` — plain member access compiles.
    expect(maybe.length).toBe(5);
  });
});

describe('assertDefined', () => {
  it('throws on null and undefined with the message', () => {
    expect(() => assertDefined(null, 'config entry')).toThrow(
      'Expected a defined value: config entry',
    );
    expect(() => assertDefined(undefined, 'config entry')).toThrow(/config entry/);
  });

  it('passes falsy-but-defined values', () => {
    expect(() => assertDefined(0, 'zero')).not.toThrow();
    expect(() => assertDefined('', 'empty string')).not.toThrow();
    expect(() => assertDefined(false, 'false')).not.toThrow();
  });

  it('narrows away null/undefined', () => {
    const items = ['a', 'b'];
    const found: string | undefined = items.find((i) => i === 'a');
    assertDefined(found, "'a' is in the fixture");
    // After the assert, `found` is `string` — no non-null assertion needed.
    expect(found.toUpperCase()).toBe('A');
  });
});
