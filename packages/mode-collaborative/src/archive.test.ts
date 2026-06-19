import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_RUN_RECORDS,
  collabRunsDir,
  listRunRecords,
  readRunRecord,
  writeRunRecord,
  type CollabRunRecord,
} from './archive.js';

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

  it('caps the archive dir at MAX_RUN_RECORDS, evicting the oldest', () => {
    // Write more than the cap; the directory must not grow unbounded.
    const total = MAX_RUN_RECORDS + 25;
    for (let i = 0; i < total; i++) {
      writeRunRecord(rec({ runId: `run-${i}`, startedAtMs: i }));
    }
    const files = readdirSync(collabRunsDir()).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(MAX_RUN_RECORDS);
    // The newest survive; the oldest (lowest startedAtMs) were evicted.
    expect(readRunRecord(`run-${total - 1}`)).not.toBeNull();
    expect(readRunRecord('run-0')).toBeNull();
    expect(readRunRecord('run-24')).toBeNull(); // the 25 oldest are gone
    expect(readRunRecord('run-25')).not.toBeNull();
  });

  it('sweeps a leftover .tmp from an interrupted atomic write', () => {
    writeRunRecord(rec({ runId: 'good' }));
    // Simulate a crash mid-write: a stray temp file.
    writeFileSync(join(collabRunsDir(), 'good.json.123.abc.tmp'), '{ partial');
    // The next write prunes/sweeps it.
    writeRunRecord(rec({ runId: 'good2' }));
    const tmps = readdirSync(collabRunsDir()).filter((f) => f.endsWith('.tmp'));
    expect(tmps).toEqual([]);
    // A .tmp is never surfaced as a record.
    expect(listRunRecords().map((r) => r.runId).sort()).toEqual(['good', 'good2']);
  });

  it('evicts an unparseable/corrupt record under the cap rather than pinning the dir', () => {
    // A corrupt file (oldest, written first) must still count toward — and be
    // evictable under — the cap, so a single bad file can't wedge the sweep.
    const dir = collabRunsDir();
    // Make the dir + drop a corrupt JSON first so it has the oldest mtime.
    writeRunRecord(rec({ runId: 'seed', startedAtMs: 0 }));
    writeFileSync(join(dir, 'corrupt.json'), '{ not json');
    // Fill well past the cap with newer, valid records.
    for (let i = 0; i < MAX_RUN_RECORDS + 5; i++) {
      writeRunRecord(rec({ runId: `r-${i}`, startedAtMs: 1000 + i }));
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(MAX_RUN_RECORDS);
    // The corrupt file (oldest mtime) was eligible for and got evicted.
    expect(files).not.toContain('corrupt.json');
  });

  it('corrupt/foreign files NEVER evict a valid record (key spaces stay separated)', () => {
    // Worst case: a flood of fresh corrupt/foreign .json files (mtime ~= now, which
    // is a far LARGER number than an old run's startedAtMs). They must be evicted
    // FIRST — they must never outrank and displace a single legitimate record.
    const dir = collabRunsDir();
    // A handful of valid records with realistically OLD start times.
    const valid = MAX_RUN_RECORDS - 3;
    for (let i = 0; i < valid; i++) {
      writeRunRecord(rec({ runId: `keep-${i}`, startedAtMs: 1000 + i }));
    }
    // Far more corrupt files than free slots — written LAST so their mtime is newest.
    for (let i = 0; i < MAX_RUN_RECORDS; i++) {
      writeFileSync(join(dir, `junk-${i}.json`), '{ not json');
    }
    // Also a file that parses but has no usable timestamp → treated as foreign.
    writeFileSync(join(dir, 'no-ts.json'), JSON.stringify({ hello: 'world' }));
    // A write triggers the prune.
    writeRunRecord(rec({ runId: 'keep-final', startedAtMs: 5000 }));

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(MAX_RUN_RECORDS);
    // EVERY legitimate record survives — none was displaced by a corrupt file.
    for (let i = 0; i < valid; i++) expect(readRunRecord(`keep-${i}`)).not.toBeNull();
    expect(readRunRecord('keep-final')).not.toBeNull();
    // The remaining slots are corrupt junk (evicted-last only because the dir isn't
    // yet over the cap with valid records alone); the foreign no-ts file ranks as
    // corrupt too, so it can be evicted and never pins a slot from a real record.
    const survivingValid = files.filter((f) => f.startsWith('keep-')).length;
    expect(survivingValid).toBe(valid + 1);
  });
});
