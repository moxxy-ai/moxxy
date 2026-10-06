import { EventEmitter, getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor, wakeAfter, type WakeSource } from './wait-for.js';

afterEach(() => {
  vi.useRealTimers();
});

/** A job that finishes when told to and wakes whoever listens. */
function job() {
  const emitter = new EventEmitter();
  let result: string | undefined;
  const changed: WakeSource = (wake) => {
    emitter.on('change', wake);
    return () => emitter.off('change', wake);
  };
  return {
    changed,
    result: () => result,
    finish(value: string) {
      result = value;
      emitter.emit('change');
    },
    listeners: () => emitter.listenerCount('change'),
  };
}

describe('waitFor', () => {
  it('wakes the moment the job reports completion, without any timer tick', async () => {
    vi.useFakeTimers();
    const j = job();
    const waiting = waitFor(j.result, { wakeOn: [j.changed], timeoutMs: 60_000 });

    j.finish('built');

    await expect(waiting).resolves.toEqual({ status: 'ready', value: 'built' });
  });

  it('returns at once when the job finished before the wait began', async () => {
    const j = job();
    j.finish('already done');

    await expect(waitFor(j.result, { wakeOn: [j.changed] })).resolves.toEqual({
      status: 'ready',
      value: 'already done',
    });
  });

  it('keeps waiting through wakes that do not settle the condition', async () => {
    const emitter = new EventEmitter();
    let lines = 0;
    const waiting = waitFor(() => (lines >= 3 ? lines : undefined), {
      wakeOn: [(wake) => (emitter.on('line', wake), () => emitter.off('line', wake))],
    });

    for (let i = 0; i < 3; i++) {
      lines += 1;
      emitter.emit('line');
    }

    await expect(waiting).resolves.toEqual({ status: 'ready', value: 3 });
  });

  it('reports a deadline as "still running", not as finished', async () => {
    vi.useFakeTimers();
    const j = job();
    const waiting = waitFor(j.result, { wakeOn: [j.changed], timeoutMs: 5_000 });

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(waiting).resolves.toEqual({ status: 'timeout' });
  });

  it('stops waiting when the turn is aborted', async () => {
    const j = job();
    const ac = new AbortController();
    const waiting = waitFor(j.result, { wakeOn: [j.changed], signal: ac.signal });

    ac.abort();

    await expect(waiting).resolves.toEqual({ status: 'aborted' });
  });

  it('leaves no listener or timer behind after any outcome', async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const done = job();
    await (done.finish('x'), waitFor(done.result, { wakeOn: [done.changed], timeoutMs: 1_000, signal: ac.signal }));
    const late = job();
    const timedOut = waitFor(late.result, { wakeOn: [late.changed], timeoutMs: 1_000, signal: ac.signal });
    await vi.advanceTimersByTimeAsync(1_000);
    await timedOut;

    expect(done.listeners()).toBe(0);
    expect(late.listeners()).toBe(0);
    expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the check’s error and cleans up', async () => {
    const j = job();
    let broken = false;
    const waiting = waitFor(
      () => {
        if (broken) throw new Error('status read failed');
        return undefined;
      },
      { wakeOn: [j.changed] },
    );

    broken = true;
    j.finish('ignored');

    await expect(waiting).rejects.toThrow('status read failed');
    expect(j.listeners()).toBe(0);
  });
});

describe('wakeAfter', () => {
  it('re-checks a time-based condition once its moment passes', async () => {
    vi.useFakeTimers();
    const bootDeadline = Date.now() + 1_000;
    const waiting = waitFor(() => (Date.now() >= bootDeadline ? 'gave up booting' : undefined), {
      wakeOn: [wakeAfter(1_000)],
    });

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(waiting).resolves.toEqual({ status: 'ready', value: 'gave up booting' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
