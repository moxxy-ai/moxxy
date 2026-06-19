import { describe, expect, it, vi } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { buildSearchIndex, filterEventsBySearch } from './ChatSurface';

/** The ORIGINAL inline predicate, verbatim, as the golden reference. */
function refFilter(events: ReadonlyArray<MoxxyEvent>, searchQuery: string): ReadonlyArray<MoxxyEvent> {
  const q = searchQuery.toLowerCase();
  return events.filter((e) => {
    if (e.type === 'user_prompt') return e.text.toLowerCase().includes(q);
    if (e.type === 'assistant_message') return e.content.toLowerCase().includes(q);
    if (e.type === 'tool_call_requested') {
      return e.name.toLowerCase().includes(q) || JSON.stringify(e.input).toLowerCase().includes(q);
    }
    if (e.type === 'error') return e.message.toLowerCase().includes(q);
    return false;
  });
}

function ev(partial: Partial<MoxxyEvent> & { type: string }): MoxxyEvent {
  return { seq: 0, id: 'x', ts: 0, ...partial } as unknown as MoxxyEvent;
}

const log: ReadonlyArray<MoxxyEvent> = [
  ev({ type: 'user_prompt', text: 'Please WRITE the config file' }),
  ev({ type: 'assistant_message', content: 'Sure, writing it now' }),
  ev({ type: 'tool_call_requested', name: 'Write', input: { path: '/etc/Config.json', body: 'NEEDLE' } }),
  ev({ type: 'tool_call_requested', name: 'Bash', input: { command: 'ls -la' } }),
  ev({ type: 'error', message: 'EACCES: permission denied' }),
  ev({ type: 'tool_result', output: 'NEEDLE in a non-searchable event' }), // not indexed → []
];

describe('ChatSurface search helpers — byte-identical to the inline predicate', () => {
  const queries = ['', 'write', 'WRITE', 'needle', 'config', 'bash', 'ls -la', 'denied', 'nomatch', '/etc/'];

  it.each(queries)('query=%j', (q) => {
    const index = buildSearchIndex(log);
    expect(filterEventsBySearch(log, index, q)).toEqual(refFilter(log, q));
  });

  it('does not JSON.stringify on the per-keystroke (filter) path', () => {
    const index = buildSearchIndex(log); // index build is allowed to stringify
    const spy = vi.spyOn(JSON, 'stringify');
    for (const q of ['n', 'ne', 'nee', 'need', 'needle']) {
      filterEventsBySearch(log, index, q);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reuses one index across many keystrokes', () => {
    const spy = vi.spyOn(JSON, 'stringify');
    const index = buildSearchIndex(log);
    const callsAfterBuild = spy.mock.calls.length;
    for (const q of ['a', 'ab', 'abc']) filterEventsBySearch(log, index, q);
    // No additional stringify calls after the one-time index build.
    expect(spy.mock.calls.length).toBe(callsAfterBuild);
    spy.mockRestore();
  });

  // Defensive: if a caller ever passes an index that is shorter than (or
  // otherwise misaligned with) `events`, the missing rows must degrade to
  // "no match" rather than throwing a TypeError on `undefined.some`.
  it('degrades a short/misaligned index to no-match instead of throwing', () => {
    const shortIndex = buildSearchIndex(log).slice(0, 2); // drop tail rows
    let result: ReadonlyArray<MoxxyEvent> = [];
    expect(() => {
      result = filterEventsBySearch(log, shortIndex, 'needle');
    }).not.toThrow();
    // The indexed user_prompt/assistant rows have no 'needle'; the dropped
    // rows can't match → empty result, no crash.
    expect(result).toEqual([]);
  });

  it('an empty index never throws and matches nothing', () => {
    expect(filterEventsBySearch(log, [], 'write')).toEqual([]);
    expect(() => filterEventsBySearch(log, [], '')).not.toThrow();
    // An empty query against an empty index still degrades to no-match (every
    // row's haystack is the `[]` fallback), not the whole log.
    expect(filterEventsBySearch(log, [], '')).toEqual([]);
  });
});
