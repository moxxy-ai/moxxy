/**
 * Unit tests for the NER hook's worker lifecycle — specifically the failure
 * path. The hook owns a single Worker (which loads a ~300 MB model); when that
 * worker dies, `detectNames` MUST short-circuit instead of posting to a dead
 * worker and leaking a forever-pending request per call.
 *
 * The real worker (`ner.worker.ts`) loads transformers.js, so it's stubbed with
 * a tiny fake whose `onmessage`/`onerror` the test drives directly. The fake
 * also records posted messages so the leak claim is asserted, not assumed.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNer } from './useNer';
import type { NerToken } from './aggregate';

interface PostedInfer {
  readonly type: string;
  readonly id: number;
  readonly text: string;
}

/** A controllable stand-in for the model worker: captures posted messages and
 *  exposes hooks to drive a reply / a fatal error from the test. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  readonly posted: PostedInfer[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(msg: PostedInfer): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulate the model emitting a per-token result for a request `id`. */
  reply(id: number, tokens: NerToken[]): void {
    this.onmessage?.({ data: { type: 'result', id, tokens } } as MessageEvent);
  }

  /** Simulate the worker dying (e.g. the model failed to load). */
  fail(message = 'boom'): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useNer', () => {
  it('aggregates the worker reply into PII spans on the happy path', async () => {
    const { result } = renderHook(() => useNer());
    const worker = FakeWorker.instances[0]!;

    let spans: readonly unknown[] = [];
    await act(async () => {
      const p = result.current.detectNames('Alice Smith met Bob');
      // The hook posts one infer request; answer it with two BIO tokens.
      const req = worker.posted.at(-1)!;
      worker.reply(req.id, [
        { entity: 'B-PER', word: 'Alice', index: 0, score: 0.99 },
        { entity: 'I-PER', word: 'Smith', index: 1, score: 0.99 },
      ]);
      spans = await p;
    });

    expect(spans).toEqual([{ category: 'person', start: 0, end: 11, value: 'Alice Smith' }]);
    expect(result.current.status).toBe('ready');
  });

  it('short-circuits detectNames after the worker dies (no leaked pending request)', async () => {
    const { result } = renderHook(() => useNer());
    const worker = FakeWorker.instances[0]!;

    // The worker fails to load — the hook flips to `error` and drops the worker.
    await act(async () => {
      worker.fail('model failed to load');
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('model failed to load');

    // A follow-up call must resolve to [] WITHOUT posting to the dead worker.
    // Before the fix this posted an infer the dead worker never answered, so the
    // promise hung forever and a `pending` entry leaked per call.
    const before = worker.posted.length;
    let spans: readonly unknown[] = [{ sentinel: true }];
    await act(async () => {
      spans = await result.current.detectNames('Alice Smith met Bob');
    });
    expect(spans).toEqual([]);
    expect(worker.posted.length).toBe(before); // no new request posted to the dead worker
  });

  it('returns [] for blank input without touching the worker', async () => {
    const { result } = renderHook(() => useNer());
    const worker = FakeWorker.instances[0]!;
    let spans: readonly unknown[] = [{ sentinel: true }];
    await act(async () => {
      spans = await result.current.detectNames('   ');
    });
    expect(spans).toEqual([]);
    expect(worker.posted.length).toBe(0);
  });

  it('settles an in-flight request to [] on unmount instead of hanging forever', async () => {
    const { result, unmount } = renderHook(() => useNer());

    // Start a request and DO NOT reply — it stays in flight (a pending entry).
    let spans: readonly unknown[] | 'unsettled' = 'unsettled';
    const p = result.current.detectNames('Alice Smith met Bob').then((s) => {
      spans = s;
    });

    // Tear the hook down while the request is pending. Before the fix the cleanup
    // only clear()'d the map, orphaning this promise so it NEVER settled (a leak);
    // now the pending request is rejected and detectNames maps it to [].
    await act(async () => {
      unmount();
      await p;
    });
    expect(spans).toEqual([]);
  });

  it('settles in-flight requests to [] when the worker errors mid-flight', async () => {
    const { result } = renderHook(() => useNer());
    const worker = FakeWorker.instances[0]!;

    let spans: readonly unknown[] | 'unsettled' = 'unsettled';
    const p = result.current.detectNames('Alice Smith met Bob').then((s) => {
      spans = s;
    });

    await act(async () => {
      worker.fail('runtime crashed');
      await p;
    });
    expect(spans).toEqual([]);
    expect(result.current.status).toBe('error');
  });
});
