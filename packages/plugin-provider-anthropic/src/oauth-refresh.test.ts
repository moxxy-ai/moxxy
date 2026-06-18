import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ProviderEvent, ProviderRequest } from '@moxxy/sdk';
import { AnthropicProvider } from './provider.js';

/**
 * Coverage for the OAuth token-refresh paths in provider.ts:
 *  - ensureFreshOauth()  : proactive near-expiry refresh BEFORE the request.
 *  - 401 -> refreshOauthNow() -> replay : reactive single refresh + replay.
 *  - refresh-failure surfacing without an infinite replay loop.
 *
 * Harness notes
 * -------------
 * `refreshOauthNow()` rebuilds `this.client` via the PRIVATE `makeOauthClient`,
 * which constructs a REAL `Anthropic` SDK client. To keep every attempt routed
 * at our fake (and off the network) across a refresh, we stub `makeOauthClient`
 * on the instance so it returns the fake — faithfully exercising the real
 * "refresh -> rebuild client -> replay" flow while staying offline. Reaching
 * into a private member for TEST SETUP mirrors the existing oauth-mode.test.ts
 * pattern (which casts to read `client`); production code is never touched.
 */

/** Install the fake on a provider, including across refresh-driven client rebuilds. */
function pinClient(p: AnthropicProvider, client: Anthropic): void {
  const internals = p as unknown as {
    client: Anthropic;
    makeOauthClient: (token: string) => Anthropic;
  };
  internals.client = client;
  internals.makeOauthClient = () => client;
}

const DONE_EVENTS = [
  { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
];

/** An error shaped like the Anthropic SDK's APIError for a 401 (carries `status`). */
function unauthorizedError(): Error {
  return Object.assign(new Error('Unauthorized'), { status: 401 });
}

interface FakeClient {
  client: Anthropic;
  /** Number of times `messages.stream` was invoked (i.e. request attempts). */
  streamCalls: number;
}

/**
 * A fake SDK client whose `messages.stream` behaviour is driven by a per-call
 * factory. The factory receives the 1-based attempt number and returns either
 * the events to yield (success) or throws (transport/HTTP error).
 */
function fakeClient(
  perAttempt: (attempt: number) => ReadonlyArray<unknown>,
): FakeClient {
  const state: FakeClient = { client: undefined as unknown as Anthropic, streamCalls: 0 };
  state.client = {
    messages: {
      stream: () => {
        state.streamCalls += 1;
        const attempt = state.streamCalls;
        // Resolve the events eagerly so a thrown error surfaces from the
        // generator body (matching how the SDK throws mid-iteration).
        return (async function* () {
          const events = perAttempt(attempt);
          for (const e of events) yield e;
        })();
      },
    },
  } as unknown as Anthropic;
  return state;
}

async function drain(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const baseReq: ProviderRequest = {
  model: 'claude-x',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
};

describe('AnthropicProvider OAuth token refresh', () => {
  it('proactively refreshes a near-expiry token before the request', async () => {
    const fake = fakeClient(() => DONE_EVENTS);
    let refreshCalls = 0;
    const refreshedAt = Date.now() + 3_600_000;

    const p = new AnthropicProvider({
      oauthToken: 'tok-old',
      oauthExpiresAt: Date.now() + 10_000, // inside the 60s skew window -> refresh
      oauthRefresh: async () => {
        refreshCalls += 1;
        return { token: 'tok-new', expiresAt: refreshedAt };
      },
      client: fake.client,
    });
    pinClient(p, fake.client);

    const out = await drain(p.stream(baseReq));

    expect(refreshCalls).toBe(1);
    // The provider swapped in the new bearer and recorded the new expiry.
    const internals = p as unknown as { oauthToken?: string; oauthExpiresAt?: number };
    expect(internals.oauthToken).toBe('tok-new');
    expect(internals.oauthExpiresAt).toBe(refreshedAt);
    // Exactly one request attempt, ending cleanly.
    expect(fake.streamCalls).toBe(1);
    expect(out.filter((e) => e.type === 'message_start')).toHaveLength(1);
    expect(out.at(-1)).toMatchObject({ type: 'message_end', stopReason: 'end_turn' });
    expect(out.some((e) => e.type === 'error')).toBe(false);
  });

  it('does NOT refresh a token that is comfortably fresh', async () => {
    const fake = fakeClient(() => DONE_EVENTS);
    let refreshCalls = 0;
    const p = new AnthropicProvider({
      oauthToken: 'tok-fresh',
      oauthExpiresAt: Date.now() + 3_600_000, // far outside the skew window
      oauthRefresh: async () => {
        refreshCalls += 1;
        return { token: 'tok-new' };
      },
      client: fake.client,
    });
    pinClient(p, fake.client);

    const out = await drain(p.stream(baseReq));

    expect(refreshCalls).toBe(0);
    expect(fake.streamCalls).toBe(1);
    expect(out.at(-1)).toMatchObject({ type: 'message_end' });
  });

  it('on a 401 refreshes once and replays, emitting exactly one message_start/message_end', async () => {
    // First attempt 401s; second attempt (post-refresh) succeeds.
    const fake = fakeClient((attempt) => {
      if (attempt === 1) throw unauthorizedError();
      return DONE_EVENTS;
    });
    let refreshCalls = 0;
    const p = new AnthropicProvider({
      oauthToken: 'tok-old',
      oauthExpiresAt: Date.now() + 3_600_000, // fresh -> no proactive refresh; the 401 drives it
      oauthRefresh: async () => {
        refreshCalls += 1;
        return { token: 'tok-new', expiresAt: Date.now() + 3_600_000 };
      },
      client: fake.client,
    });
    pinClient(p, fake.client);

    const out = await drain(p.stream(baseReq));

    // Refreshed exactly once; replayed exactly once (two stream attempts total).
    expect(refreshCalls).toBe(1);
    expect(fake.streamCalls).toBe(2);
    expect((p as unknown as { oauthToken?: string }).oauthToken).toBe('tok-new');
    // The provider yields a single message_start (from stream()) regardless of
    // the internal replay, and a single terminal message_end from the successful
    // attempt. No error event on a recovered 401.
    expect(out.filter((e) => e.type === 'message_start')).toHaveLength(1);
    expect(out.filter((e) => e.type === 'message_end')).toHaveLength(1);
    expect(out.some((e) => e.type === 'error')).toBe(false);
    expect(out.at(-1)).toMatchObject({ type: 'message_end', stopReason: 'end_turn' });
  });

  it('surfaces a single error and does NOT replay again when the replay also 401s', async () => {
    // Every attempt 401s. The provider must refresh once, replay once, then
    // surface the error — never loop.
    const fake = fakeClient(() => {
      throw unauthorizedError();
    });
    let refreshCalls = 0;
    const p = new AnthropicProvider({
      oauthToken: 'tok-old',
      oauthExpiresAt: Date.now() + 3_600_000,
      oauthRefresh: async () => {
        refreshCalls += 1;
        return { token: 'tok-new' };
      },
      client: fake.client,
    });
    pinClient(p, fake.client);

    const out = await drain(p.stream(baseReq));

    // Refreshed once, two attempts (original + single replay), then stop.
    expect(refreshCalls).toBe(1);
    expect(fake.streamCalls).toBe(2);
    const errors = out.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    // The terminal event is the error; no second message_end.
    expect(out.at(-1)).toMatchObject({ type: 'error' });
    expect(out.filter((e) => e.type === 'message_end')).toHaveLength(0);
  });

  it('surfaces a clear error when the refresh callback itself throws (no replay)', async () => {
    const fake = fakeClient((attempt) => {
      if (attempt === 1) throw unauthorizedError();
      return DONE_EVENTS;
    });
    let refreshCalls = 0;
    const p = new AnthropicProvider({
      oauthToken: 'tok-old',
      oauthExpiresAt: Date.now() + 3_600_000,
      oauthRefresh: async () => {
        refreshCalls += 1;
        throw new Error('refresh endpoint down');
      },
      client: fake.client,
    });
    pinClient(p, fake.client);

    const out = await drain(p.stream(baseReq));

    // Attempted the refresh once after the 401; it threw, so NO replay attempt.
    expect(refreshCalls).toBe(1);
    expect(fake.streamCalls).toBe(1);
    const errors = out.filter((e): e is Extract<ProviderEvent, { type: 'error' }> => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('refresh endpoint down');
    expect(out.filter((e) => e.type === 'message_end')).toHaveLength(0);
  });

  it('surfaces a clear error when a proactive (pre-request) refresh throws, and does not send a request', async () => {
    const fake = fakeClient(() => DONE_EVENTS);
    let refreshCalls = 0;
    const p = new AnthropicProvider({
      oauthToken: 'tok-old',
      oauthExpiresAt: Date.now() + 5_000, // near expiry -> proactive refresh fires
      oauthRefresh: async () => {
        refreshCalls += 1;
        throw new Error('proactive refresh failed');
      },
      client: fake.client,
    });
    pinClient(p, fake.client);

    const out = await drain(p.stream(baseReq));

    expect(refreshCalls).toBe(1);
    // Proactive refresh failed before the request — no stream attempt at all.
    expect(fake.streamCalls).toBe(0);
    const errors = out.filter((e): e is Extract<ProviderEvent, { type: 'error' }> => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('proactive refresh failed');
  });

  it('countTokens proactively refreshes a near-expiry token before counting', async () => {
    let countCalls = 0;
    const client = {
      messages: {
        countTokens: async () => {
          countCalls += 1;
          return { input_tokens: 42 };
        },
      },
    } as unknown as Anthropic;
    let refreshCalls = 0;
    const refreshedAt = Date.now() + 3_600_000;
    const p = new AnthropicProvider({
      oauthToken: 'tok-old',
      oauthExpiresAt: Date.now() + 10_000, // inside the 60s skew window -> refresh
      oauthRefresh: async () => {
        refreshCalls += 1;
        return { token: 'tok-new', expiresAt: refreshedAt };
      },
      client,
    });
    pinClient(p, client);

    const n = await p.countTokens(baseReq);

    expect(n).toBe(42);
    expect(refreshCalls).toBe(1);
    expect(countCalls).toBe(1);
    const internals = p as unknown as { oauthToken?: string; oauthExpiresAt?: number };
    expect(internals.oauthToken).toBe('tok-new');
    expect(internals.oauthExpiresAt).toBe(refreshedAt);
  });

  it('does not refresh on a non-401 error (surfaces it directly, single attempt)', async () => {
    const serverError = Object.assign(new Error('boom'), { status: 500 });
    const fake = fakeClient(() => {
      throw serverError;
    });
    let refreshCalls = 0;
    const p = new AnthropicProvider({
      oauthToken: 'tok-old',
      oauthExpiresAt: Date.now() + 3_600_000,
      oauthRefresh: async () => {
        refreshCalls += 1;
        return { token: 'tok-new' };
      },
      client: fake.client,
    });
    pinClient(p, fake.client);

    const out = await drain(p.stream(baseReq));

    expect(refreshCalls).toBe(0);
    expect(fake.streamCalls).toBe(1);
    expect(out.filter((e) => e.type === 'error')).toHaveLength(1);
  });
});
