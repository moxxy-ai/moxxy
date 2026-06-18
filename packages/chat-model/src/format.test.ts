import { describe, expect, it } from 'vitest';
import {
  buildCompactSummary,
  compactPreviewLine,
  formatElapsed,
  formatTokensK,
  summarizeArgs,
} from './format.js';
import type { LiveToolCall } from './types.js';

function makeCall(
  name: string,
  compact: { verb: string; one: string; other: string; previewKey?: string },
  input: unknown,
): LiveToolCall {
  return {
    id: `id-${name}-${Math.random()}`,
    request: {
      type: 'tool_call_requested',
      callId: name as never,
      name,
      input,
    } as never,
    compact: {
      verb: compact.verb,
      noun: { one: compact.one, other: compact.other },
      previewKey: compact.previewKey,
    },
    outcome: null,
  };
}

describe('formatElapsed', () => {
  it('renders seconds below a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(12_000)).toBe('12s');
    expect(formatElapsed(59_000)).toBe('59s');
  });

  it('crosses the minute boundary with zero-padded seconds', () => {
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(3_599_000)).toBe('59m 59s');
  });

  it('crosses the hour boundary with zero-padded minutes', () => {
    expect(formatElapsed(3_600_000)).toBe('1h 00m');
    expect(formatElapsed(3_660_000)).toBe('1h 01m');
  });

  it('clamps negative input to 0s', () => {
    expect(formatElapsed(-5000)).toBe('0s');
  });
});

describe('formatTokensK', () => {
  it('returns null for null/undefined/negative', () => {
    expect(formatTokensK(null)).toBeNull();
    expect(formatTokensK(undefined)).toBeNull();
    expect(formatTokensK(-1)).toBeNull();
  });

  it('returns the raw count below 1000', () => {
    expect(formatTokensK(0)).toBe('0');
    expect(formatTokensK(999)).toBe('999');
  });

  it('returns a k-suffixed one-decimal value at/above 1000', () => {
    expect(formatTokensK(1000)).toBe('1.0k');
    expect(formatTokensK(65_300)).toBe('65.3k');
  });
});

describe('summarizeArgs', () => {
  it('returns empty string for null/undefined and empty object', () => {
    expect(summarizeArgs(null)).toBe('');
    expect(summarizeArgs(undefined)).toBe('');
    expect(summarizeArgs({})).toBe('');
  });

  it('truncates a top-level string argument', () => {
    const long = 'x'.repeat(200);
    const out = summarizeArgs(long);
    expect(out.length).toBeLessThanOrEqual(61); // 60 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses newlines/tabs in a top-level string', () => {
    expect(summarizeArgs('a\n\tb')).toBe('a b');
  });

  it('renders non-object primitives via String()', () => {
    expect(summarizeArgs(42)).toBe('42');
    expect(summarizeArgs(true)).toBe('true');
  });

  it('joins object entries and caps the total at ARG_SUMMARY_MAX', () => {
    expect(summarizeArgs({ a: 1, b: 'two' })).toBe('a=1, b="two"');
    const wide = summarizeArgs({
      query: 'a'.repeat(50),
      user_intent: 'b'.repeat(50),
      design_type: 'c'.repeat(50),
    });
    expect(wide.length).toBeLessThanOrEqual(91); // 90 + ellipsis
    expect(wide.endsWith('…')).toBe(true);
  });
});

describe('buildCompactSummary', () => {
  it('returns empty string with no calls', () => {
    expect(buildCompactSummary([], true)).toBe('');
  });

  it('groups by tool name preserving insertion order and pluralizes counts', () => {
    const calls = [
      makeCall('Read', { verb: 'Reading', one: 'file', other: 'files' }, {}),
      makeCall('Grep', { verb: 'Searching for', one: 'pattern', other: 'patterns' }, {}),
      makeCall('Read', { verb: 'Reading', one: 'file', other: 'files' }, {}),
    ];
    // first verb keeps its casing; subsequent verbs are lowercased.
    expect(buildCompactSummary(calls, false)).toBe('Reading 2 files, searching for 1 pattern');
  });

  it('appends an ellipsis only while in flight', () => {
    const calls = [makeCall('Read', { verb: 'Reading', one: 'file', other: 'files' }, {})];
    expect(buildCompactSummary(calls, true)).toBe('Reading 1 file…');
    expect(buildCompactSummary(calls, false)).toBe('Reading 1 file');
  });
});

describe('compactPreviewLine', () => {
  it('uses previewKey when the field is a string', () => {
    const call = makeCall(
      'Read',
      { verb: 'Reading', one: 'file', other: 'files', previewKey: 'file_path' },
      { file_path: '/tmp/a.txt' },
    );
    expect(compactPreviewLine(call)).toBe('/tmp/a.txt');
  });

  it('falls back to summarizeArgs when previewKey is missing or non-string', () => {
    const noKey = makeCall('X', { verb: 'Doing', one: 'thing', other: 'things' }, { a: 1 });
    expect(compactPreviewLine(noKey)).toBe('a=1');
    const nonStr = makeCall(
      'X',
      { verb: 'Doing', one: 'thing', other: 'things', previewKey: 'k' },
      { k: 5 },
    );
    expect(compactPreviewLine(nonStr)).toBe('k=5');
  });
});
