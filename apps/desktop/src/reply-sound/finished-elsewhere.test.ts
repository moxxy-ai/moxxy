import { describe, expect, it } from 'vitest';
import { finishedElsewhere } from './finished-elsewhere';

const run = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('finishedElsewhere', () => {
  it('names a chat that was answering and no longer is, when another chat is on screen', () => {
    expect(finishedElsewhere({ before: run('b'), after: run(), known: run('a', 'b'), onScreen: 'a' })).toEqual(['b']);
  });

  it('leaves out the chat on screen: its answer is being read', () => {
    expect(finishedElsewhere({ before: run('a'), after: run(), known: run('a', 'b'), onScreen: 'a' })).toEqual([]);
  });

  it('leaves out a chat that is still answering', () => {
    expect(finishedElsewhere({ before: run('b', 'c'), after: run('c'), known: run('a', 'b', 'c'), onScreen: 'a' })).toEqual(['b']);
  });

  it('leaves out a chat that was removed while it answered', () => {
    expect(finishedElsewhere({ before: run('b'), after: run(), known: run('a'), onScreen: 'a' })).toEqual([]);
  });

  it('names nothing when a chat starts answering', () => {
    expect(finishedElsewhere({ before: run(), after: run('b'), known: run('a', 'b'), onScreen: 'a' })).toEqual([]);
  });

  it('counts every chat as elsewhere when no chat is on screen', () => {
    expect(finishedElsewhere({ before: run('a'), after: run(), known: run('a'), onScreen: null })).toEqual(['a']);
  });
});
