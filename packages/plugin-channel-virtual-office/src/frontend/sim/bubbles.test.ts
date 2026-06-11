import { describe, expect, it } from 'vitest';
import { BubbleChannel, firstSentence, trailingPiece } from './bubbles.js';

describe('trailingPiece', () => {
  it('returns text after the last sentence boundary', () => {
    expect(trailingPiece('First sentence. Second part')).toBe('Second part');
    expect(trailingPiece('One! Two? Three is ongoing')).toBe('Three is ongoing');
  });

  it('falls back to the last full sentence when text ends at a boundary', () => {
    expect(trailingPiece('All done.')).toBe('All done.');
    expect(trailingPiece('First one. Second one!')).toBe('Second one!');
  });

  it('does not split on dots not followed by space/end (e.g. file names)', () => {
    expect(trailingPiece('reading types.ts now')).toBe('reading types.ts now');
  });

  it('caps at the last 80 chars when there is no boundary', () => {
    const long = 'x'.repeat(200);
    expect(trailingPiece(long)).toBe('x'.repeat(80));
  });

  it('collapses whitespace', () => {
    expect(trailingPiece('hello\n\n  world\t!')).toBe('hello world !');
  });
});

describe('firstSentence', () => {
  it('returns the first sentence including its terminator', () => {
    expect(firstSentence('Done with the task. More text follows.')).toBe('Done with the task.');
  });

  it('returns the whole text when no boundary, capped at 80', () => {
    expect(firstSentence('no terminator here')).toBe('no terminator here');
    const long = 'y'.repeat(120);
    expect(firstSentence(long)).toHaveLength(80);
    expect(firstSentence(long).endsWith('…')).toBe(true);
  });
});

describe('BubbleChannel', () => {
  it('surfaces streamed deltas immediately on first read, then throttles at 600ms', () => {
    const b = new BubbleChannel();
    b.push('Hello', 0);
    expect(b.current(0)).toEqual({ text: 'Hello', tone: 'speech' });
    b.push(' world', 100);
    // Inside the throttle window: previous snapshot stays.
    expect(b.current(100)).toEqual({ text: 'Hello', tone: 'speech' });
    expect(b.current(599)).toEqual({ text: 'Hello', tone: 'speech' });
    // 600ms after the last emit: refreshed snapshot.
    expect(b.current(600)).toEqual({ text: 'Hello world', tone: 'speech' });
  });

  it('shows the trailing piece after a sentence boundary', () => {
    const b = new BubbleChannel();
    b.push('First sentence. Second', 0);
    expect(b.current(0)).toEqual({ text: 'Second', tone: 'speech' });
  });

  it('expires the streamed bubble 3000ms after the last push', () => {
    const b = new BubbleChannel();
    b.push('hi', 0);
    expect(b.current(3000)).not.toBeNull();
    expect(b.current(3001)).toBeNull();
    // A new push revives it.
    b.push(' again', 4000);
    expect(b.current(4000)).not.toBeNull();
  });

  it('say() overrides streaming for its ttl, then streaming resumes if fresh', () => {
    const b = new BubbleChannel();
    b.push('streaming text', 0);
    expect(b.current(0)).toEqual({ text: 'streaming text', tone: 'speech' });
    b.say('[bash]', 'tool', 100);
    expect(b.current(150)).toEqual({ text: '[bash]', tone: 'tool' });
    expect(b.current(2599)).toEqual({ text: '[bash]', tone: 'tool' });
    // say expired at 100+2500=2600; stream still fresh (< 3000 since push).
    expect(b.current(2700)).toEqual({ text: 'streaming text', tone: 'speech' });
  });

  it('say() honors a custom ttl', () => {
    const b = new BubbleChannel();
    b.say('done', 'speech', 0, 4000);
    expect(b.current(3999)).toEqual({ text: 'done', tone: 'speech' });
    expect(b.current(4000)).toBeNull();
  });

  it('does not resume an expired stream after say() ends', () => {
    const b = new BubbleChannel();
    b.push('old stream', 0);
    b.say('alert!', 'alert', 2000);
    expect(b.current(2100)).toEqual({ text: 'alert!', tone: 'alert' });
    // say expires at 4500; the stream expired at 3000.
    expect(b.current(5000)).toBeNull();
  });

  it('clear() drops everything', () => {
    const b = new BubbleChannel();
    b.push('text', 0);
    b.say('tool', 'tool', 0);
    b.clear();
    expect(b.current(0)).toBeNull();
  });
});
