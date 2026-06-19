import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
import { pollUntil } from './poll-until.js';

const abortListeners = (signal: AbortSignal): number => getEventListeners(signal, 'abort').length;

describe('pollUntil — abort-event listener hygiene', () => {
  it('does not accumulate abort listeners across poll iterations', async () => {
    // sleep() adds one `abort` listener per inter-poll wait against the SAME
    // long-lived signal. If the timer-resolved path doesn't remove it, a device
    // flow polling for minutes would pile up listeners and trip
    // MaxListenersExceededWarning. Assert the count never grows past 1.
    const controller = new AbortController();
    const { signal } = controller;
    let polls = 0;
    let maxListeners = 0;
    const result = await pollUntil(
      async () => {
        polls += 1;
        maxListeners = Math.max(maxListeners, abortListeners(signal));
        return polls >= 5 ? { done: 'ok' as const } : { pending: true as const };
      },
      { intervalMs: 1, timeoutMs: 5_000, signal, leadingWait: false },
    );
    expect(result).toBe('ok');
    expect(polls).toBe(5);
    // At most one abort listener is ever attached at a time — no leak.
    expect(maxListeners).toBeLessThanOrEqual(1);
    // And none is left dangling after the flow resolves.
    expect(abortListeners(signal)).toBe(0);
  });

  it('rejects with NETWORK_ABORTED when the signal aborts mid-wait', async () => {
    const controller = new AbortController();
    const pending = pollUntil(async () => ({ pending: true as const }), {
      intervalMs: 50,
      timeoutMs: 5_000,
      signal: controller.signal,
      leadingWait: true,
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'NETWORK_ABORTED' });
    controller.abort();
    await rejected;
    // The abort listener is detached on the reject path too.
    expect(abortListeners(controller.signal)).toBe(0);
  });

  it('throws OAUTH_FLOW_TIMEOUT once the deadline passes', async () => {
    let err: unknown;
    try {
      await pollUntil(async () => ({ pending: true as const }), {
        intervalMs: 1,
        timeoutMs: 10,
        leadingWait: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MoxxyError);
    expect((err as MoxxyError).code).toBe('OAUTH_FLOW_TIMEOUT');
  });
});
