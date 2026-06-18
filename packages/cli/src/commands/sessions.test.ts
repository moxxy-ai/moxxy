import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '@moxxy/core';

import { resolveId } from './sessions.js';

function meta(id: string): SessionMeta {
  return {
    id,
    cwd: '/tmp',
    startedAt: '2026-01-01T00:00:00.000Z',
    lastActivity: '2026-01-01T00:00:00.000Z',
    eventCount: 0,
    firstPrompt: null,
    provider: null,
    model: null,
  };
}

const all = [meta('aaaa-1111'), meta('aaaa-2222'), meta('bbbb-3333')];

describe('resolveId', () => {
  it('resolves a 1-based numeric index into the list', () => {
    expect(resolveId('1', all)).toBe('aaaa-1111');
    expect(resolveId('3', all)).toBe('bbbb-3333');
  });

  it('returns the raw input for an out-of-range index (no match)', () => {
    expect(resolveId('9', all)).toBe('9');
    expect(resolveId('0', all)).toBe('0');
  });

  it('matches an exact id', () => {
    expect(resolveId('aaaa-2222', all)).toBe('aaaa-2222');
  });

  it('resolves a unique suffix', () => {
    expect(resolveId('3333', all)).toBe('bbbb-3333');
  });

  it('resolves a unique prefix', () => {
    expect(resolveId('bbbb', all)).toBe('bbbb-3333');
  });

  it('returns the raw input on an ambiguous suffix/prefix (caller surfaces not-found)', () => {
    // "aaaa" prefixes two entries → ambiguous → echo input back.
    expect(resolveId('aaaa', all)).toBe('aaaa');
  });

  it('returns the raw input when nothing matches', () => {
    expect(resolveId('zzz', all)).toBe('zzz');
  });

  it('trims surrounding whitespace before resolving', () => {
    expect(resolveId('  aaaa-1111  ', all)).toBe('aaaa-1111');
    expect(resolveId(' 2 ', all)).toBe('aaaa-2222');
  });
});
