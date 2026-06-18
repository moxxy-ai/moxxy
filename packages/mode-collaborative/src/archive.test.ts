import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collabRunsDir, listRunRecords, readRunRecord, writeRunRecord, type CollabRunRecord } from './archive.js';

let home: string;
const prev = process.env.MOXXY_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mc-archive-'));
  process.env.MOXXY_HOME = home;
});
afterEach(() => {
  if (prev === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

function rec(over: Partial<CollabRunRecord>): CollabRunRecord {
  return {
    runId: 'r1',
    task: 'build it',
    startedAtMs: 1000,
    finishedAtMs: 2000,
    outcome: 'completed',
    parallel: true,
    gitRepo: true,
    agents: [{ id: 'backend', name: 'Backend', role: 'implementer', status: 'done', subtask: 'api', doneSummary: 'done' }],
    doneCount: 1,
    totalCount: 1,
    board: [],
    contracts: [],
    messageCount: 0,
    ...over,
  };
}

describe('run archive', () => {
  it('writes a record under ~/.moxxy/collab/runs and reads it back', () => {
    writeRunRecord(rec({ runId: 'abc' }));
    expect(collabRunsDir()).toBe(join(home, 'collab', 'runs'));
    const got = readRunRecord('abc');
    expect(got?.task).toBe('build it');
    expect(got?.agents[0]?.id).toBe('backend');
  });

  it('lists runs newest-first and respects the limit', () => {
    writeRunRecord(rec({ runId: 'old', startedAtMs: 100 }));
    writeRunRecord(rec({ runId: 'new', startedAtMs: 9000 }));
    writeRunRecord(rec({ runId: 'mid', startedAtMs: 5000 }));
    const all = listRunRecords();
    expect(all.map((r) => r.runId)).toEqual(['new', 'mid', 'old']);
    expect(listRunRecords(2).map((r) => r.runId)).toEqual(['new', 'mid']);
  });

  it('skips a corrupt record instead of failing the whole list', () => {
    writeRunRecord(rec({ runId: 'good' }));
    writeFileSync(join(collabRunsDir(), 'broken.json'), '{ not json');
    const all = listRunRecords();
    expect(all.map((r) => r.runId)).toEqual(['good']);
  });

  it('returns [] when no archive dir exists', () => {
    expect(listRunRecords()).toEqual([]);
    expect(readRunRecord('nope')).toBeNull();
  });
});
