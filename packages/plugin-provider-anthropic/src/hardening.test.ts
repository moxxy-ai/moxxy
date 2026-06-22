import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ProviderEvent, ProviderRequest } from '@moxxy/sdk';
import { AnthropicProvider } from './provider.js';

/**
 * Worst-case / failure-path coverage for the hardening fixes in provider.ts
 * that landed without a dedicated regression test:
 *
 *  - SDK stream teardown on early exit (abort / consumer abandonment) — the
 *    `finally` block must force-abort the SDK stream so a half-open HTTP
 *    connection can't linger under Esc-spam.
 *  - OAuth refresh concurrency coalescing — two concurrent near-expiry callers
 *    must share a single in-flight refresh (one endpoint hit, one client swap).
 *  - countTokens offline fallback — must NOT serialize megabytes of base64 into
 *    one mega-string; a multi-MB media blob yields a bounded, blob-independent
 *    estimate.
 *  - Index-less degraded stream — a stale, already-finished blockIndexToId entry
 *    must not misroute a new tool block's input deltas.
 *  - message_delta usage merge — delta-reported input/cache numbers win when
 *    present, message_start values survive when absent.
 */

async function drain(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/**
 * A fake SDK stream object that is BOTH async-iterable AND exposes the
 * `abort()` / `controller.abort()` surface the provider's finally-block reaches
 * for. The inner generator hangs on an open "HTTP body" promise after the first
 * events; that promise REJECTS the moment `abort()`/`controller.abort()` fires
 * (or the request `signal` aborts), faithfully mirroring how the real SDK
 * unblocks a pending `.next()` on teardown — so the test can't hang.
 */
function abortableStream(signal?: AbortSignal): {
  stream: AsyncIterable<unknown> & { abort: () => void; controller: { abort: () => void } };
  aborts: { abort: number; controller: number };
} {
  const aborts = { abort: 0, controller: 0 };
  let rejectBody: ((e: Error) => void) | undefined;
  const tearDown = (): void => rejectBody?.(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  signal?.addEventListener('abort', tearDown);
  const controller = {
    abort: () => {
      aborts.controller += 1;
      tearDown();
    },
  };
  async function* gen(): AsyncGenerator<unknown> {
    // First events so the provider enters the loop and records output, then
    // hang on an open body until torn down.
    yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } };
    await new Promise<void>((_res, rej) => {
      rejectBody = rej;
    });
  }
  const g = gen();
  const stream = Object.assign(g, {
    abort: () => {
      aborts.abort += 1;
      tearDown();
    },
    controller,
  });
  return { stream, aborts };
}

describe('AnthropicProvider stream teardown', () => {
  it('force-aborts the SDK stream when the signal aborts mid-stream', async () => {
    const controller = new AbortController();
    const { stream, aborts } = abortableStream(controller.signal);
    const client = {
      messages: { stream: () => stream, countTokens: async () => ({ input_tokens: 0 }) },
    };
    const p = new AnthropicProvider({ client: client as never });

    const out: ProviderEvent[] = [];
    const it = p.stream({ model: 'm', messages: [], signal: controller.signal })[
      Symbol.asyncIterator
    ]();
    // Pull until the first content event arrives, then abort. The fake's open
    // body promise rejects on signal-abort (as the real SDK does), unblocking
    // the provider's pending pull so its catch/finally run deterministically.
    // stream() yields its own message_start first; streamOnce does NOT emit a
    // second one — it processes the fake's message_start silently, then yields
    // the text_delta. So: pull1 = message_start, pull2 = text_delta 'partial',
    // pull3 = provider awaits the hung body.
    out.push((await it.next()).value); // message_start (from stream())
    out.push((await it.next()).value); // text_delta 'partial'
    const nextP = it.next(); // provider now awaits the hung body
    controller.abort(); // rejects the body -> provider catch sees signal.aborted
    out.push((await nextP).value); // 'aborted' error event
    await it.next(); // drive generator to done (runs finally -> teardown)

    // The finally-block tore the SDK stream down.
    expect(aborts.abort + aborts.controller).toBeGreaterThan(0);
    const abortedErr = out.find((e) => e?.type === 'error');
    expect(abortedErr).toMatchObject({ message: 'aborted', retryable: false });
  });

  it('force-aborts the SDK stream when the consumer abandons the generator between events', async () => {
    // Here the body is NOT hung: events stream eagerly. The consumer pulls a few
    // then `.return()`s before the stream completes. The for-await is suspended
    // BETWEEN yields (not inside an un-abortable await), so .return() unwinds it
    // and our finally runs the teardown (drained never became true).
    const aborts = { abort: 0, controller: 0 };
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'c' } };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
      yield { type: 'message_stop' };
    }
    const stream = Object.assign(gen(), {
      abort: () => {
        aborts.abort += 1;
      },
      controller: {
        abort: () => {
          aborts.controller += 1;
        },
      },
    });
    const client = {
      messages: { stream: () => stream, countTokens: async () => ({ input_tokens: 0 }) },
    };
    const p = new AnthropicProvider({ client: client as never });

    const it = p.stream({ model: 'm', messages: [] })[Symbol.asyncIterator]();
    await it.next(); // message_start (stream())
    await it.next(); // message_start (streamOnce)
    await it.next(); // text_delta 'a'
    // Consumer walks away before the stream completes (drained stays false).
    await it.return?.(undefined);

    expect(aborts.abort + aborts.controller).toBeGreaterThan(0);
  });

  it('does NOT abort the SDK stream on a clean completion (no teardown on the happy path)', async () => {
    const aborts = { abort: 0, controller: 0 };
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
      yield { type: 'message_stop' };
    }
    const stream = Object.assign(gen(), {
      abort: () => {
        aborts.abort += 1;
      },
      controller: {
        abort: () => {
          aborts.controller += 1;
        },
      },
    });
    const client = {
      messages: { stream: () => stream, countTokens: async () => ({ input_tokens: 0 }) },
    };
    const p = new AnthropicProvider({ client: client as never });
    const out = await drain(p.stream({ model: 'm', messages: [] }));
    expect(out.at(-1)).toMatchObject({ type: 'message_end', stopReason: 'end_turn' });
    // Drained naturally — teardown must NOT fire (would abort an already-closed
    // request and could cancel keep-alive reuse).
    expect(aborts.abort + aborts.controller).toBe(0);
  });
});

describe('AnthropicProvider OAuth refresh concurrency', () => {
  it('coalesces concurrent near-expiry refreshes onto a single in-flight refresh', async () => {
    let refreshCalls = 0;
    let resolveRefresh: ((v: { token: string; expiresAt: number }) => void) | undefined;
    const refreshGate = new Promise<{ token: string; expiresAt: number }>((res) => {
      resolveRefresh = res;
    });

    const streamCalls = { n: 0 };
    const fakeStream = (): AsyncIterable<unknown> =>
      (async function* () {
        streamCalls.n += 1;
        yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
        yield { type: 'message_stop' };
      })();
    const client = {
      messages: { stream: fakeStream, countTokens: async () => ({ input_tokens: 0 }) },
    } as unknown as Anthropic;

    const p = new AnthropicProvider({
      oauthToken: 'tok-old',
      oauthExpiresAt: Date.now() + 5_000, // inside skew window -> both callers want a refresh
      oauthRefresh: async () => {
        refreshCalls += 1;
        return refreshGate;
      },
      client,
    });
    // Pin the fake across the refresh-driven client rebuild.
    const internals = p as unknown as {
      client: Anthropic;
      makeOauthClient: (t: string) => Anthropic;
    };
    internals.makeOauthClient = () => client;

    const baseReq: ProviderRequest = { model: 'm', messages: [] };
    // Kick off two streams concurrently; both observe the stale expiry and call
    // ensureFreshOauth before the (gated) refresh resolves.
    const p1 = drain(p.stream(baseReq));
    const p2 = drain(p.stream(baseReq));
    // Let both reach the awaited refresh, then release it.
    await Promise.resolve();
    await Promise.resolve();
    resolveRefresh!({ token: 'tok-new', expiresAt: Date.now() + 3_600_000 });
    const [o1, o2] = await Promise.all([p1, p2]);

    // The refresh endpoint was hit exactly once despite two concurrent callers.
    expect(refreshCalls).toBe(1);
    expect((p as unknown as { oauthToken?: string }).oauthToken).toBe('tok-new');
    expect(o1.some((e) => e.type === 'error')).toBe(false);
    expect(o2.some((e) => e.type === 'error')).toBe(false);
    expect(streamCalls.n).toBe(2); // both turns still went out
  });
});

describe('AnthropicProvider countTokens offline fallback', () => {
  it('does not stringify a multi-MB base64 image blob, yielding a bounded estimate', async () => {
    // A 4 MB base64 image: if the fallback stringified the bytes, the estimate
    // would be ~1,000,000 tokens. The fixed media allowance keeps it tiny.
    const bigData = 'A'.repeat(4_000_000);
    let serialized = '';
    const client = {
      messages: {
        countTokens: async () => {
          throw new Error('countTokens unreachable');
        },
        stream: () => (async function* () {})(),
      },
    };
    // Spy on JSON.stringify to prove the blob is never serialized.
    const origStringify = JSON.stringify;
    const spy = (v: unknown, ...rest: unknown[]): string => {
      const s = origStringify(v as never, ...(rest as []));
      if (s.length > serialized.length) serialized = s;
      return s;
    };
    JSON.stringify = spy as typeof JSON.stringify;
    try {
      const p = new AnthropicProvider({ client: client as never });
      const n = await p.countTokens({
        model: 'm',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe this' },
              { type: 'image', mediaType: 'image/png', data: bigData },
            ],
          },
        ],
      });
      // Bounded estimate, NOT proportional to the 4 MB blob.
      expect(n).toBeLessThan(10_000);
      expect(n).toBeGreaterThan(0);
      // No stringify call ever materialized the base64 payload.
      expect(serialized.length).toBeLessThan(bigData.length);
    } finally {
      JSON.stringify = origStringify;
    }
  });

  it('falls back to a char-based estimate (not a crash) when the API count throws', async () => {
    const client = {
      messages: {
        countTokens: async () => {
          throw new Error('network down');
        },
        stream: () => (async function* () {})(),
      },
    };
    const p = new AnthropicProvider({ client: client as never });
    const n = await p.countTokens({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(400) }] }],
    });
    // ~400 chars / 4 ≈ 100 tokens (plus the empty tools array length).
    expect(n).toBeGreaterThanOrEqual(100);
    expect(n).toBeLessThan(150);
  });
});

describe('AnthropicProvider message_delta usage merge', () => {
  it('prefers delta-reported input/cache tokens over message_start values when present', async () => {
    const client = {
      messages: {
        stream: () =>
          (async function* () {
            yield {
              type: 'message_start',
              message: {
                usage: {
                  input_tokens: 100,
                  output_tokens: 0,
                  cache_read_input_tokens: 10,
                },
              },
            };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
            // The delta CORRECTS input + cache numbers (some streaming modes do).
            yield {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: {
                input_tokens: 120,
                output_tokens: 5,
                cache_read_input_tokens: 30,
                cache_creation_input_tokens: 7,
              },
            };
            yield { type: 'message_stop' };
          })(),
        countTokens: async () => ({ input_tokens: 0 }),
      },
    };
    const p = new AnthropicProvider({ client: client as never });
    const out = await drain(p.stream({ model: 'm', messages: [] }));
    expect(out.at(-1)).toMatchObject({
      type: 'message_end',
      usage: {
        inputTokens: 120,
        outputTokens: 5,
        cacheReadTokens: 30,
        cacheCreationTokens: 7,
      },
    });
  });
});

describe('AnthropicProvider degraded index-less stream', () => {
  it('does not misroute a second tool block onto a stale finished entry when index is absent', async () => {
    // No `index` on any event (older SDK / hand-rolled). Two strictly-serial
    // tool blocks. The first finishes (its pendingToolUses entry is deleted on
    // tool_use_end); the SECOND block's deltas must route to B, not the stale A
    // entry left lingering in blockIndexToId.
    const client = {
      messages: {
        stream: () =>
          (async function* () {
            yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
            yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 'A', name: 'Read' } };
            yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a":1}' } };
            yield { type: 'content_block_stop' };
            yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 'B', name: 'Glob' } };
            yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"b":2}' } };
            yield { type: 'content_block_stop' };
            yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } };
            yield { type: 'message_stop' };
          })(),
        countTokens: async () => ({ input_tokens: 0 }),
      },
    };
    const p = new AnthropicProvider({ client: client as never });
    const out = await drain(p.stream({ model: 'm', messages: [] }));
    const ends = out.filter((e) => e.type === 'tool_use_end');
    expect(ends).toHaveLength(2);
    const endA = ends.find((e) => 'id' in e && (e as { id: string }).id === 'A');
    const endB = ends.find((e) => 'id' in e && (e as { id: string }).id === 'B');
    // Each tool received only its OWN input — no cross-routing onto a stale entry.
    expect(endA).toMatchObject({ id: 'A', input: { a: 1 } });
    expect(endB).toMatchObject({ id: 'B', input: { b: 2 } });
  });
});
