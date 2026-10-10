import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Session } from '@moxxy/core';
import { defineTool, type MoxxyEvent } from '@moxxy/sdk';
import { errorsOf, finalText, liveSession, liveTurn, openLiveCodex } from './live-session.js';

/**
 * The Codex provider against the real ChatGPT backend, on the developer's own
 * sign-in. Asserts structure (no error, tools answered, the right number) and
 * never exact wording. Run with `pnpm test:live`; the pre-push hook runs it
 * when a push touches the request path.
 */
const live = await openLiveCodex();
if ('skip' in live) console.warn(`[live-check] skipped: ${live.skip}`);

const NUMBERS: Record<string, number> = { alpha: 17, beta: 25 };
const lookupNumber = defineTool({
  name: 'lookup_number',
  description: 'Return the secret number stored under a key. Keys: alpha, beta.',
  inputSchema: z.object({ key: z.enum(['alpha', 'beta']) }),
  handler: ({ key }) => ({ key, number: NUMBERS[key] }),
});
const TWO_LOOKUPS =
  'Call lookup_number with key "alpha". After you have its result, call lookup_number with key "beta" ' +
  '(one call at a time, not in parallel). Then reply with only the sum of the two numbers.';

const okToolResults = (events: ReadonlyArray<MoxxyEvent>) =>
  events.filter((event) => event.type === 'tool_result' && event.ok).length;

describe.skipIf('skip' in live)('Codex on the live ChatGPT backend', () => {
  let session: Session | undefined;
  afterEach(async () => {
    await session?.close();
    session = undefined;
  });
  const provider = () => {
    if ('skip' in live) throw new Error(live.skip);
    return live.provider;
  };

  it('answers a plain prompt', async () => {
    session = liveSession(provider(), { reasoning: false });
    const events = await liveTurn(session, 'Reply with exactly the single word PONG.');
    expect(errorsOf(events)).toEqual([]);
    expect(finalText(events)).toMatch(/PONG/i);
  });

  it('continues a turn across two tool calls, replaying its reasoning state', async () => {
    session = liveSession(provider(), { tools: [lookupNumber], reasoning: false });
    const events = await liveTurn(session, TWO_LOOKUPS);
    expect(errorsOf(events)).toEqual([]);
    expect(okToolResults(events)).toBeGreaterThanOrEqual(2);
    // The model decides whether a call carries reasoning state at all; the unit
    // suites prove it is kept, this one that the backend takes it back.
    if (!events.some((event) => event.type === 'reasoning_message' && (event.replayItems?.length ?? 0) > 0)) {
      console.warn('[live-check] the model sent no reasoning state this run, so its replay was not exercised');
    }
    expect(finalText(events)).toMatch(/\b42\b/);
  });

  it('continues across tool calls with visible reasoning summaries on', async () => {
    session = liveSession(provider(), { tools: [lookupNumber], reasoning: true });
    const events = await liveTurn(session, TWO_LOOKUPS);
    expect(errorsOf(events)).toEqual([]);
    expect(okToolResults(events)).toBeGreaterThanOrEqual(2);
    expect(finalText(events)).toMatch(/\b42\b/);
  });

  it('stops cleanly when aborted mid-answer, and the session takes the next prompt', async () => {
    session = liveSession(provider(), { reasoning: false });
    const controller = new AbortController();
    const unsubscribe = session.log.subscribe((event) => {
      if (event.type === 'assistant_chunk' || event.type === 'reasoning_chunk') controller.abort();
    });
    const aborted = await liveTurn(session, 'Count from 1 to 200, one number per line.', { signal: controller.signal });
    unsubscribe();
    expect(controller.signal.aborted).toBe(true);
    expect(aborted.some((event) => event.type === 'abort')).toBe(true);

    const next = await liveTurn(session, 'Reply with exactly the single word PONG.');
    expect(errorsOf(next)).toEqual([]);
    expect(finalText(next)).toMatch(/PONG/i);
  });
});
