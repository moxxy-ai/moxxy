import { describe, expect, it } from 'vitest';
import { callsForAttention, type SessionActivity } from './calls-for-attention';

const chats = (...ids: string[]): ReadonlySet<string> => new Set(ids);
const activity = (entries: Record<string, SessionActivity>): ReadonlyMap<string, SessionActivity> =>
  new Map(Object.entries(entries));

describe('callsForAttention', () => {
  it('names a chat that was working and no longer is: it answered', () => {
    expect(callsForAttention({ before: activity({ b: 'working' }), after: activity({}), known: chats('a', 'b') })).toEqual([
      { sessionId: 'b', reason: 'answered' },
    ]);
  });

  it('names a chat that stopped to ask, though its turn is still open', () => {
    expect(
      callsForAttention({ before: activity({ b: 'working' }), after: activity({ b: 'asking' }), known: chats('a', 'b') }),
    ).toEqual([{ sessionId: 'b', reason: 'asked' }]);
  });

  it('names a chat that asks without a turn of its own, as a paused workflow does', () => {
    expect(callsForAttention({ before: activity({}), after: activity({ b: 'asking' }), known: chats('b') })).toEqual([
      { sessionId: 'b', reason: 'asked' },
    ]);
  });

  it('says nothing while a chat keeps asking, or goes back to work once it is answered', () => {
    const known = chats('b');
    expect(callsForAttention({ before: activity({ b: 'asking' }), after: activity({ b: 'asking' }), known })).toEqual([]);
    expect(callsForAttention({ before: activity({ b: 'asking' }), after: activity({ b: 'working' }), known })).toEqual([]);
  });

  it('names a chat that was asking and is done: the turn ended on the decision', () => {
    expect(callsForAttention({ before: activity({ b: 'asking' }), after: activity({}), known: chats('b') })).toEqual([
      { sessionId: 'b', reason: 'answered' },
    ]);
  });

  it('leaves out a chat that is still working, and one that only started', () => {
    expect(
      callsForAttention({
        before: activity({ b: 'working', c: 'working' }),
        after: activity({ c: 'working', d: 'working' }),
        known: chats('b', 'c', 'd'),
      }),
    ).toEqual([{ sessionId: 'b', reason: 'answered' }]);
  });

  it('leaves out a chat that was removed: it did not finish', () => {
    expect(callsForAttention({ before: activity({ b: 'working' }), after: activity({}), known: chats('a') })).toEqual([]);
    expect(callsForAttention({ before: activity({}), after: activity({ b: 'asking' }), known: chats('a') })).toEqual([]);
  });
});
