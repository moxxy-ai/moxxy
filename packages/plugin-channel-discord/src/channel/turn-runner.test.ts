import { describe, expect, it } from 'vitest';
import { asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { SendableChannelLike, SentMessageLike } from './discord-like.js';
import { TypingIndicator } from './typing-indicator.js';
import {
  clampEditFrameMs,
  DEFAULT_EDIT_FRAME_MS,
  MIN_EDIT_FRAME_MS,
  runDiscordTurn,
} from './turn-runner.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('clampEditFrameMs (Discord edit rate limit ~5 edits/5s)', () => {
  it('defaults when unset and floors configured values at 1200ms', () => {
    expect(clampEditFrameMs(undefined)).toBe(DEFAULT_EDIT_FRAME_MS);
    expect(DEFAULT_EDIT_FRAME_MS).toBeGreaterThanOrEqual(1_200);
    expect(clampEditFrameMs(50)).toBe(MIN_EDIT_FRAME_MS);
    expect(MIN_EDIT_FRAME_MS).toBeGreaterThanOrEqual(1_200);
    expect(clampEditFrameMs(5_000)).toBe(5_000);
    expect(clampEditFrameMs(Number.NaN)).toBe(DEFAULT_EDIT_FRAME_MS);
  });
});

interface Recorded {
  sends: string[];
  edits: string[];
  channel: SendableChannelLike;
}

function recordedChannel(): Recorded {
  const sends: string[] = [];
  const edits: string[] = [];
  const channel: SendableChannelLike = {
    send: async (payload) => {
      sends.push(typeof payload === 'string' ? payload : payload.content);
      const message: SentMessageLike = {
        edit: async (content: string) => {
          edits.push(content);
        },
      };
      return message;
    },
  };
  return { sends, edits, channel };
}

/**
 * Fake session: `runTurn` pushes scripted events (stamped with the given
 * turnId) through the log subscribers, mirroring how the real Session fans
 * out; the async iterable then completes.
 */
function fakeSession(
  script: (emit: (e: Record<string, unknown>) => Promise<void>) => Promise<void>,
): Session {
  const listeners = new Set<(e: MoxxyEvent) => void>();
  return {
    log: {
      subscribe(fn: (e: MoxxyEvent) => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    runTurn: (_prompt: string, opts: { turnId: string }) =>
      (async function* () {
        const emit = async (e: Record<string, unknown>): Promise<void> => {
          const event = { ...e, turnId: opts.turnId } as unknown as MoxxyEvent;
          for (const fn of listeners) fn(event);
        };
        await script(emit);
        // The iterator yields nothing extra — rendering happens via the log.
        yield undefined as never;
      })(),
  } as unknown as Session;
}

describe('runDiscordTurn — send-once-then-edit streaming', () => {
  it('sends the first frame, edits it as chunks stream, edits the final in place', async () => {
    const { sends, edits, channel } = recordedChannel();
    const session = fakeSession(async (emit) => {
      await emit({ type: 'assistant_chunk', delta: 'Hello' });
      await sleep(30);
      await emit({ type: 'assistant_chunk', delta: ', world' });
      await sleep(30);
      await emit({ type: 'assistant_message', content: 'Hello, world. Done.' });
    });
    await runDiscordTurn(
      { session, channel, typing: new TypingIndicator(), editFrameMs: 10 },
      { text: 'hi', controller: new AbortController(), turnId: asTurnId('turn-1') },
    );
    // Exactly one streamed message; later frames are edits of it.
    expect(sends).toHaveLength(1);
    expect(sends[0]!.startsWith('Hello')).toBe(true);
    expect(edits.length).toBeGreaterThanOrEqual(1);
    expect(edits[edits.length - 1]).toBe('Hello, world. Done.');
  });

  it('splits a long FINAL frame: edits the head, sends the tails as follow-ups', async () => {
    const { sends, edits, channel } = recordedChannel();
    const line = 'y'.repeat(100);
    const long = Array.from({ length: 45 }, () => line).join('\n'); // ~4545 chars > 1900*2
    const session = fakeSession(async (emit) => {
      await emit({ type: 'assistant_chunk', delta: 'start' });
      await sleep(30);
      await emit({ type: 'assistant_message', content: long });
    });
    await runDiscordTurn(
      { session, channel, typing: new TypingIndicator(), editFrameMs: 10 },
      { text: 'hi', controller: new AbortController(), turnId: asTurnId('turn-2') },
    );
    // First send is the streamed head; final tails arrive as extra sends.
    expect(sends.length).toBeGreaterThanOrEqual(3); // head + >=2 tails
    const finalHead = edits[edits.length - 1]!;
    expect(finalHead.length).toBeLessThanOrEqual(1_900);
    // Reassembling head + tails recovers the whole final text.
    const reassembled = [finalHead, ...sends.slice(1)].join('\n');
    expect(reassembled).toBe(long);
  });

  it('posts a placeholder when the turn rendered nothing', async () => {
    const { sends, channel } = recordedChannel();
    const session = fakeSession(async () => undefined);
    await runDiscordTurn(
      { session, channel, typing: new TypingIndicator(), editFrameMs: 10 },
      { text: 'hi', controller: new AbortController(), turnId: asTurnId('turn-3') },
    );
    expect(sends).toEqual(['*(no output)*']);
  });

  it('ignores events from OTHER turns (invariant #8: filter by turnId)', async () => {
    const { sends, edits, channel } = recordedChannel();
    const listeners = new Set<(e: MoxxyEvent) => void>();
    const session = {
      log: {
        subscribe(fn: (e: MoxxyEvent) => void) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      runTurn: (_prompt: string, opts: { turnId: string }) =>
        (async function* () {
          const fan = (e: Record<string, unknown>): void => {
            for (const fn of listeners) fn(e as unknown as MoxxyEvent);
          };
          // A concurrent foreign turn's chunk must NOT render here.
          fan({ type: 'assistant_chunk', delta: 'FOREIGN', turnId: 'other-turn' });
          fan({ type: 'assistant_message', content: 'mine', turnId: opts.turnId });
          yield undefined as never;
        })(),
    } as unknown as Session;
    await runDiscordTurn(
      { session, channel, typing: new TypingIndicator(), editFrameMs: 10 },
      { text: 'hi', controller: new AbortController(), turnId: asTurnId('turn-4') },
    );
    const all = [...sends, ...edits].join(' ');
    expect(all).toContain('mine');
    expect(all).not.toContain('FOREIGN');
  });

  it('surfaces a failed turn into the channel instead of dangling', async () => {
    const { sends, channel } = recordedChannel();
    const session = {
      log: { subscribe: () => () => undefined },
      runTurn: () =>
        (async function* () {
          yield undefined as never;
          throw new Error('provider exploded');
        })(),
    } as unknown as Session;
    await runDiscordTurn(
      { session, channel, typing: new TypingIndicator(), editFrameMs: 10 },
      { text: 'hi', controller: new AbortController(), turnId: asTurnId('turn-5') },
    );
    expect(sends.join(' ')).toMatch(/Turn failed: provider exploded/);
  });
});
