import { describe, expect, it } from 'vitest';
import { Inbox, untilStopped } from './inbox.js';

describe('the inbox an agent session reads in order', () => {
  it('hands items out in the order they came, waking a reader that waits', async () => {
    const inbox = new Inbox<string>();
    const first = inbox.next();
    inbox.push('a');
    inbox.push('b');
    expect(await first).toBe('a');
    expect(await inbox.next()).toBe('b');
  });

  it('drains what is queued now', () => {
    const inbox = new Inbox<number>();
    inbox.push(1);
    inbox.push(2);
    expect(inbox.drain()).toEqual([1, 2]);
    expect(inbox.drain()).toEqual([]);
  });
});

describe('waiting on the person until the turn stops', () => {
  it('gives the work its own answer', async () => {
    await expect(untilStopped(Promise.resolve('yes'), new AbortController().signal, 'stopped')).resolves.toBe('yes');
  });

  it('gives the fallback once the turn stops, even if the work never answers', async () => {
    const stop = new AbortController();
    const waiting = untilStopped(new Promise<string>(() => undefined), stop.signal, 'stopped');
    stop.abort();
    await expect(waiting).resolves.toBe('stopped');
  });

  it('gives the fallback at once when the turn already stopped', async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(untilStopped(new Promise<string>(() => undefined), stop.signal, 'stopped')).resolves.toBe('stopped');
  });
});
