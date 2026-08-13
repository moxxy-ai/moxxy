import { describe, expect, it } from 'vitest';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { filterDesks } from './filter-desks';

const DESKS: ReadonlyArray<Desk> = [
  {
    id: 'd1',
    name: 'blocky',
    cwd: '/Users/me/personal/blocky',
    color: '#000',
    createdAt: 1,
    activeSessionId: 's1',
    sessions: [
      { id: 's1', name: 'retry untyped gateway fault', createdAt: 1 },
      { id: 's2', name: 'enterprise audit follow-ups', createdAt: 2 },
    ],
  },
  {
    id: 'd2',
    name: 'companion',
    cwd: '/Users/me/personal/companion',
    color: '#111',
    createdAt: 2,
    activeSessionId: null,
    sessions: [{ id: 's3', name: 'gateway pairing regression', createdAt: 3 }],
  },
];

describe('filterDesks', () => {
  it('returns everything, by identity, for an empty query', () => {
    expect(filterDesks(DESKS, '')).toBe(DESKS);
    expect(filterDesks(DESKS, '   ')).toBe(DESKS);
  });

  it('keeps ALL sessions of a workspace that matches by name', () => {
    // You asked for the workspace, so you want what is in it. Trimming its
    // sessions would answer a different question than the one typed.
    const [only] = filterDesks(DESKS, 'blocky');
    expect(only?.id).toBe('d1');
    expect(only?.sessions).toHaveLength(2);
  });

  it('matches a workspace on its PATH, not just its name', () => {
    // Which of six checkouts this is usually gets answered by the path.
    expect(filterDesks(DESKS, 'personal/companion').map((d) => d.id)).toEqual(['d2']);
  });

  it('keeps only the matching sessions of a workspace that does not itself match', () => {
    const result = filterDesks(DESKS, 'gateway');
    expect(result.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(result[0]?.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(result[1]?.sessions.map((s) => s.id)).toEqual(['s3']);
  });

  it('drops a workspace entirely when neither it nor any session matches', () => {
    expect(filterDesks(DESKS, 'nothing-here')).toEqual([]);
  });

  it('is case-insensitive on every field it searches', () => {
    expect(filterDesks(DESKS, 'BLOCKY').map((d) => d.id)).toEqual(['d1']);
    expect(filterDesks(DESKS, 'ENTERPRISE')[0]?.sessions.map((s) => s.id)).toEqual(['s2']);
  });

  it('never mutates the input desks', () => {
    const before = JSON.stringify(DESKS);
    filterDesks(DESKS, 'gateway');
    expect(JSON.stringify(DESKS)).toBe(before);
  });
});
