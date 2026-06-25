import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '@moxxy/core';
import {
  buildSessionPickerOptions,
  formatAgo,
  NEW_SESSION_OPTION_ID,
} from './sessions-picker.js';

function meta(over: Partial<SessionMeta> & { id: string }): SessionMeta {
  return {
    cwd: '/repo',
    startedAt: '2026-06-25T11:00:00.000Z',
    lastActivity: '2026-06-25T12:00:00.000Z',
    eventCount: 3,
    firstPrompt: 'do a thing',
    provider: 'openai',
    model: 'gpt-test',
    ...over,
  };
}

describe('buildSessionPickerOptions', () => {
  const NOW = Date.parse('2026-06-25T12:00:30.000Z');

  it('always leads with a "new session" entry', () => {
    const opts = buildSessionPickerOptions([], 'none', NOW);
    expect(opts[0]!.id).toBe(NEW_SESSION_OPTION_ID);
    expect(opts).toHaveLength(1);
  });

  it('marks the active session current with an "active" badge', () => {
    const opts = buildSessionPickerOptions(
      [meta({ id: 'a' }), meta({ id: 'b' })],
      'b',
      NOW,
    );
    const a = opts.find((o) => o.id === 'a')!;
    const b = opts.find((o) => o.id === 'b')!;
    expect(b.current).toBe(true);
    expect(b.badge).toBe('active');
    expect(a.current).toBeUndefined();
    expect(a.badge).toBeUndefined();
  });

  it('uses the first prompt as the title and shows last-active + event count + model', () => {
    const opts = buildSessionPickerOptions(
      [meta({ id: 'a', firstPrompt: 'fix the login bug', eventCount: 7, model: 'gpt-test' })],
      'other',
      NOW,
    );
    const a = opts.find((o) => o.id === 'a')!;
    expect(a.label).toBe('fix the login bug');
    expect(a.description).toContain('7 ev');
    expect(a.description).toContain('gpt-test');
    expect(a.description).toContain('ago');
  });

  it('prefers a user-set title (rename) over the first prompt', () => {
    const opts = buildSessionPickerOptions(
      [meta({ id: 'a', title: 'Login work', firstPrompt: 'fix the login bug' })],
      'other',
      NOW,
    );
    expect(opts.find((o) => o.id === 'a')!.label).toBe('Login work');
  });

  it('truncates an over-long title to 60 chars with an ellipsis', () => {
    const long = 'x'.repeat(120);
    const opts = buildSessionPickerOptions([meta({ id: 'a', firstPrompt: long })], 'other', NOW);
    const label = opts.find((o) => o.id === 'a')!.label;
    expect(label.length).toBe(60);
    expect(label.endsWith('…')).toBe(true);
  });

  it('hides empty non-active sessions but keeps an empty ACTIVE one', () => {
    const opts = buildSessionPickerOptions(
      [
        meta({ id: 'empty-other', firstPrompt: null, eventCount: 0 }),
        meta({ id: 'empty-active', firstPrompt: null, eventCount: 0 }),
      ],
      'empty-active',
      NOW,
    );
    expect(opts.find((o) => o.id === 'empty-other')).toBeUndefined();
    const active = opts.find((o) => o.id === 'empty-active')!;
    expect(active).toBeDefined();
    expect(active.label).toBe('(empty session)');
  });

  it('preserves the input order (newest-first as readSessionIndex returns)', () => {
    const opts = buildSessionPickerOptions(
      [meta({ id: 'newest' }), meta({ id: 'older' })],
      'x',
      NOW,
    );
    const ids = opts.filter((o) => o.id !== NEW_SESSION_OPTION_ID).map((o) => o.id);
    expect(ids).toEqual(['newest', 'older']);
  });
});

describe('formatAgo', () => {
  const NOW = Date.parse('2026-06-25T12:00:00.000Z');
  it('formats seconds / minutes / hours / days', () => {
    expect(formatAgo('2026-06-25T11:59:30.000Z', NOW)).toBe('30s ago');
    expect(formatAgo('2026-06-25T11:30:00.000Z', NOW)).toBe('30m ago');
    expect(formatAgo('2026-06-25T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(formatAgo('2026-06-22T12:00:00.000Z', NOW)).toBe('3d ago');
  });
  it('returns the raw string for an unparseable timestamp', () => {
    expect(formatAgo('not-a-date', NOW)).toBe('not-a-date');
  });
});
