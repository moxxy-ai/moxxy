/**
 * Worst-case coverage for the collaboration-lock parsing the `collab.active` /
 * `collab.end` handlers feed to `process.kill`.
 *
 * That parse + path derivation USED to live inline in `./session`; it now lives
 * in `@moxxy/mode-collaborative`'s collab-store (the on-disk-layout contract the
 * coordinator WRITES and this host READS), so the handlers and the coordinator
 * can't drift. This suite pins the contract from the HOST's consumer side: the
 * parse is the only guard between a renderer-invisible, on-disk lock file
 * (possibly truncated mid-write or corrupt) and a `process.kill(info.pid, 0)`
 * liveness probe — a regression that loosened it could hand a garbage /
 * out-of-range pid to `process.kill`, throwing inside the handler, or trust a
 * non-integer pid. The "treat anything not a clean positive-integer pid as no
 * live holder" rule is locked here AND in the store's own suite.
 */

import { describe, expect, it } from 'vitest';

import { collabLockPath, parseCollabLock } from '@moxxy/mode-collaborative';

describe('parseCollabLock (collab.active/end on-disk lock guard)', () => {
  it('parses a well-formed lock record', () => {
    const info = parseCollabLock(
      JSON.stringify({ pid: 1234, sessionId: 's1', task: 'do a thing', startedAtMs: 1000 }),
    );
    expect(info).toEqual({ pid: 1234, sessionId: 's1', task: 'do a thing', startedAtMs: 1000 });
  });

  it('defaults missing optional string/number fields rather than throwing', () => {
    const info = parseCollabLock(JSON.stringify({ pid: 42 }));
    expect(info).toEqual({ pid: 42, sessionId: '', task: '', startedAtMs: 0 });
  });

  it('coerces wrong-typed optional fields to safe defaults (never trusts them)', () => {
    const info = parseCollabLock(
      JSON.stringify({ pid: 42, sessionId: 99, task: { x: 1 }, startedAtMs: 'soon' }),
    );
    // pid is the only field handed to process.kill; the rest are display-only
    // and must degrade to empty/zero, not propagate a wrong type to the UI.
    expect(info).toEqual({ pid: 42, sessionId: '', task: '', startedAtMs: 0 });
  });

  it('returns null on truncated / non-JSON (a half-written lock)', () => {
    expect(parseCollabLock('{"pid": 12')).toBeNull();
    expect(parseCollabLock('')).toBeNull();
    expect(parseCollabLock('not json at all')).toBeNull();
  });

  it('returns null for JSON that is not an object', () => {
    expect(parseCollabLock('1234')).toBeNull();
    expect(parseCollabLock('"1234"')).toBeNull();
    expect(parseCollabLock('null')).toBeNull();
    expect(parseCollabLock('[1,2,3]')).toBeNull(); // array → no usable pid field
    expect(parseCollabLock('true')).toBeNull();
  });

  it('rejects a missing, non-numeric, or NaN pid (never reaches process.kill)', () => {
    expect(parseCollabLock(JSON.stringify({ sessionId: 's' }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: '1234' }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: null }))).toBeNull();
    expect(parseCollabLock('{"pid": NaN}')).toBeNull(); // invalid JSON anyway
    expect(parseCollabLock(JSON.stringify({ pid: Number.NaN }))).toBeNull(); // serializes to null
  });

  it('rejects a non-integer / non-positive pid (a bad value would throw in kill)', () => {
    expect(parseCollabLock(JSON.stringify({ pid: 12.5 }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: 0 }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: -1 }))).toBeNull();
    expect(parseCollabLock(JSON.stringify({ pid: -9999 }))).toBeNull();
  });
});

describe('collabLockPath (the coordinator contract the host reads)', () => {
  it('honors the MOXXY_COLLAB_LOCK override', () => {
    const prev = process.env.MOXXY_COLLAB_LOCK;
    process.env.MOXXY_COLLAB_LOCK = '/tmp/custom.lock';
    try {
      expect(collabLockPath()).toBe('/tmp/custom.lock');
    } finally {
      if (prev === undefined) delete process.env.MOXXY_COLLAB_LOCK;
      else process.env.MOXXY_COLLAB_LOCK = prev;
    }
  });
});
