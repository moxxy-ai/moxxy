import { describe, expect, it, vi } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import { runSlackTurn } from './turn-runner.js';
import type { SlackClient } from './slack-client.js';

/** A fake event log that fans out to subscribers, like the real session.log. */
class FakeLog {
  private readonly subs = new Set<(e: MoxxyEvent) => void>();
  subscribe(fn: (e: MoxxyEvent) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  emit(e: MoxxyEvent): void {
    for (const s of this.subs) s(e);
  }
}

function chunk(turnId: string, delta: string): MoxxyEvent {
  return {
    id: `e_${Math.random()}`,
    seq: 0,
    ts: 0,
    sessionId: 's1',
    turnId,
    source: 'model',
    type: 'assistant_chunk',
    delta,
  } as MoxxyEvent;
}

function message(turnId: string, content: string): MoxxyEvent {
  return {
    id: `e_${Math.random()}`,
    seq: 0,
    ts: 0,
    sessionId: 's1',
    turnId,
    source: 'model',
    type: 'assistant_message',
    content,
    stopReason: 'end_turn',
  } as MoxxyEvent;
}

/** Records every chat.postMessage / chat.update so the test can assert on Slack output. */
function fakeClient(): {
  client: SlackClient;
  posts: Array<{ channel: string; text: string; threadTs?: string }>;
  edits: Array<{ channel: string; ts: string; text: string }>;
} {
  const posts: Array<{ channel: string; text: string; threadTs?: string }> = [];
  const edits: Array<{ channel: string; ts: string; text: string }> = [];
  let n = 0;
  const client = {
    async postMessage(args: { channel: string; text: string; threadTs?: string }) {
      posts.push(args);
      return { channel: args.channel, ts: `ts_${++n}` };
    },
    async updateMessage(args: { channel: string; ts: string; text: string }) {
      edits.push(args);
    },
  } as unknown as SlackClient;
  return { client, posts, edits };
}

describe('runSlackTurn (turnId-filtered streaming)', () => {
  it('streams only the matching turnId into the thread', async () => {
    vi.useFakeTimers();
    const log = new FakeLog();
    const { client, posts, edits } = fakeClient();

    // runTurn emits onto the shared log: our turn's chunks PLUS a foreign turn's
    // chunk that must never reach Slack. Resolves after emitting.
    const session = {
      log,
      runTurn(_prompt: string, opts: { turnId: string }) {
        const ownTurn = opts.turnId;
        return (async function* () {
          log.emit(chunk('foreign-turn', 'SHOULD NOT APPEAR'));
          log.emit(chunk(ownTurn, 'Hello'));
          log.emit(chunk(ownTurn, ', world'));
          log.emit(message(ownTurn, 'Hello, world!'));
          log.emit(chunk('foreign-turn', 'ALSO NOT THIS'));
          yield message(ownTurn, 'Hello, world!');
        })();
      },
    } as unknown as Session;

    const controller = new AbortController();
    const promise = runSlackTurn(
      { session, client, editFrameMs: 1000 },
      {
        channel: 'C1',
        threadTs: '111.222',
        text: '<@UBOT> hi',
        controller,
        turnId: 'own-turn',
      },
    );
    // Drain timers (the debounced flush) and the turn.
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();

    // Exactly one message posted into the right thread, carrying the final text.
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ channel: 'C1', threadTs: '111.222' });
    // The final flush carries the complete assistant_message content.
    const finalText = edits.length > 0 ? edits[edits.length - 1]?.text : posts[0]?.text;
    expect(finalText).toBe('Hello, world!');

    // No foreign-turn text ever reached Slack.
    const allText = [...posts.map((p) => p.text), ...edits.map((e) => e.text)].join('\n');
    expect(allText).not.toContain('SHOULD NOT APPEAR');
    expect(allText).not.toContain('ALSO NOT THIS');
  });

  it('posts a "(no output)" placeholder when a turn produces nothing', async () => {
    vi.useFakeTimers();
    const log = new FakeLog();
    const { client, posts } = fakeClient();
    const session = {
      log,
      runTurn() {
        return (async function* () {
          // no events
        })();
      },
    } as unknown as Session;

    const promise = runSlackTurn(
      { session, client, editFrameMs: 1000 },
      { channel: 'C1', threadTs: '1.2', text: 'hi', controller: new AbortController(), turnId: 't' },
    );
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();

    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toContain('no output');
  });
});
