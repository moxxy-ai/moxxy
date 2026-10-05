import { describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asTurnId } from './ids.js';
import type { MoxxyEvent } from './events.js';
import { progressOf, unfinishedWork } from './progress.js';

/**
 * What a tool last saw of something may be work that has not finished yet: a
 * page still busy, a job still running. In the Coolify task the agent pressed
 * Deploy and reported the address as down from a check made before it — the
 * service came up minutes later. A result that names what it looked at
 * (`progress.key`) and says whether that was still under way
 * (`progress.pending`) lets the loop tell finished from not-yet.
 */
const sid = asSessionId('s1');
const t1 = asTurnId('t1');

function event(seq: number, partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>): MoxxyEvent {
  return { id: asEventId(`e${seq}`), seq, ts: seq, sessionId: sid, ...partial } as MoxxyEvent;
}

function look(seq: number, callId: string, output: unknown, ok = true): MoxxyEvent[] {
  return [
    event(seq, { type: 'tool_call_requested', turnId: t1, source: 'model', callId, name: 'look', input: {} }),
    event(seq + 1, { type: 'tool_result', turnId: t1, source: 'tool', callId, ok, output }),
  ];
}

describe('progressOf', () => {
  it('reads what a result says it looked at and whether that was still under way', () => {
    expect(progressOf({ text: 'x', progress: { key: 'browser:t1', pending: 'uploading' } })).toEqual({
      key: 'browser:t1',
      pending: 'uploading',
    });
    expect(progressOf({ progress: { key: 'browser:t1', pending: null } })).toEqual({ key: 'browser:t1', pending: null });
  });

  it('is null for a result that says nothing about it', () => {
    expect(progressOf('plain text')).toBeNull();
    expect(progressOf({ text: 'x' })).toBeNull();
    expect(progressOf({ progress: { pending: 'no key' } })).toBeNull();
  });
});

describe('unfinishedWork', () => {
  it('names what was still under way the last time it was looked at', () => {
    const events = [
      ...look(0, 'c1', { progress: { key: 'browser:t1', pending: 'progressbar "Deploying"' } }),
      ...look(2, 'c2', { text: 'something else entirely' }),
    ];

    expect(unfinishedWork(events)).toEqual(['progressbar "Deploying"']);
  });

  it('lets a later look that found it finished settle it', () => {
    const events = [
      ...look(0, 'c1', { progress: { key: 'browser:t1', pending: 'busy' } }),
      ...look(2, 'c2', { progress: { key: 'browser:t1', pending: null } }),
    ];

    expect(unfinishedWork(events)).toEqual([]);
  });

  it('keeps one thing still running while another finished', () => {
    const events = [
      ...look(0, 'c1', { progress: { key: 'browser:t1', pending: 'busy' } }),
      ...look(2, 'c2', { progress: { key: 'browser:t2', pending: 'uploading' } }),
      ...look(4, 'c3', { progress: { key: 'browser:t1', pending: null } }),
    ];

    expect(unfinishedWork(events)).toEqual(['uploading']);
  });

  it('does not count a failed call as a look', () => {
    const events = [
      ...look(0, 'c1', { progress: { key: 'browser:t1', pending: 'busy' } }),
      ...look(2, 'c2', { progress: { key: 'browser:t1', pending: null } }, false),
    ];

    expect(unfinishedWork(events)).toEqual(['busy']);
  });
});
