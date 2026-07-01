/**
 * The on-disk-layout contract is read by TWO processes (the coordinator here and
 * the desktop host directly off disk), so its defensive parse + path derivation
 * are load-bearing. These lock the "treat anything not a clean positive-integer
 * pid as no live holder" guard and the path/override rules a future
 * simplification could silently reopen.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collabLockPath,
  collabRunsDir,
  isCollabHolderAlive,
  moxxyHome,
  parseCollabLock,
  readCollabLock,
} from './collab-store.js';

describe('parseCollabLock', () => {
  it('parses a well-formed lock record (incl. the runner socket a UI attaches to)', () => {
    expect(
      parseCollabLock(
        JSON.stringify({
          pid: 1234,
          sessionId: 's1',
          task: 'do a thing',
          startedAtMs: 1000,
          runnerSocket: '/tmp/c.sock',
        }),
      ),
    ).toEqual({ pid: 1234, sessionId: 's1', task: 'do a thing', startedAtMs: 1000, runnerSocket: '/tmp/c.sock' });
  });

  it('defaults a missing runnerSocket (older lock) to empty string', () => {
    expect(
      parseCollabLock(JSON.stringify({ pid: 1234, sessionId: 's1', task: 'do a thing', startedAtMs: 1000 })),
    ).toEqual({ pid: 1234, sessionId: 's1', task: 'do a thing', startedAtMs: 1000, runnerSocket: '' });
  });

  it('defaults / coerces wrong-typed optional fields to safe values (never trusts them)', () => {
    expect(parseCollabLock(JSON.stringify({ pid: 42 }))).toEqual({
      pid: 42,
      sessionId: '',
      task: '',
      startedAtMs: 0,
      runnerSocket: '',
    });
    expect(
      parseCollabLock(
        JSON.stringify({ pid: 42, sessionId: 99, task: { x: 1 }, startedAtMs: 'soon', runnerSocket: 5 }),
      ),
    ).toEqual({
      pid: 42,
      sessionId: '',
      task: '',
      startedAtMs: 0,
      runnerSocket: '',
    });
  });

  it('returns null on truncated / non-JSON / non-object input', () => {
    expect(parseCollabLock('{"pid": 12')).toBeNull();
    expect(parseCollabLock('')).toBeNull();
    expect(parseCollabLock('not json at all')).toBeNull();
    expect(parseCollabLock('1234')).toBeNull();
    expect(parseCollabLock('null')).toBeNull();
    expect(parseCollabLock('[1,2,3]')).toBeNull();
  });

  it('rejects a missing / non-numeric / non-integer / non-positive pid', () => {
    expect(parseCollabLock(JSON.stringify({ sessionId: 's' }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: '1234' }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: 12.5 }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: 0 }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: -1 }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: Number.NaN }))).toBeNull(); // serializes to null
  });
});

describe('isCollabHolderAlive', () => {
  it('reports the current process alive and a definitely-dead pid not alive', () => {
    expect(isCollabHolderAlive(process.pid)).toBe(true);
    // 2147483646 ≈ INT_MAX-1: no such process on any sane machine → ESRCH.
    expect(isCollabHolderAlive(2147483646)).toBe(false);
  });
});

describe('paths + readCollabLock', () => {
  let home: string;
  const prevHome = process.env.MOXXY_HOME;
  const prevLock = process.env.MOXXY_COLLAB_LOCK;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mc-store-'));
    process.env.MOXXY_HOME = home;
    delete process.env.MOXXY_COLLAB_LOCK;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.MOXXY_HOME;
    else process.env.MOXXY_HOME = prevHome;
    if (prevLock === undefined) delete process.env.MOXXY_COLLAB_LOCK;
    else process.env.MOXXY_COLLAB_LOCK = prevLock;
    rmSync(home, { recursive: true, force: true });
  });

  it('derives the lock + runs paths under MOXXY_HOME', () => {
    expect(moxxyHome()).toBe(home);
    expect(collabLockPath()).toBe(join(home, 'collab', 'active.lock'));
    expect(collabRunsDir()).toBe(join(home, 'collab', 'runs'));
  });

  it('honors the MOXXY_COLLAB_LOCK override (the coordinator contract)', () => {
    process.env.MOXXY_COLLAB_LOCK = join(home, 'custom.lock');
    expect(collabLockPath()).toBe(join(home, 'custom.lock'));
  });

  it('reads a written lock back and returns null for a missing / corrupt file', () => {
    // Point the lock at a path directly under `home` (no nested dir to create).
    process.env.MOXXY_COLLAB_LOCK = join(home, 'lock.json');
    expect(readCollabLock()).toBeNull(); // nothing written yet
    writeFileSync(
      join(home, 'lock.json'),
      JSON.stringify({ pid: process.pid, sessionId: 'x', task: 't', startedAtMs: 7, runnerSocket: '/tmp/x.sock' }),
    );
    expect(readCollabLock()).toEqual({
      pid: process.pid,
      sessionId: 'x',
      task: 't',
      startedAtMs: 7,
      runnerSocket: '/tmp/x.sock',
    });
    writeFileSync(join(home, 'lock.json'), '{ truncated');
    expect(readCollabLock()).toBeNull();
  });
});
