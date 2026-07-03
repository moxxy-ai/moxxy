import { describe, expect, it } from 'vitest';
import { asTurnId } from '@moxxy/sdk';
import type { MoxxyEvent } from '@moxxy/sdk';
import { TurnCoordinator, driveTurn, subscribeTurn } from './turn.js';

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

describe('subscribeTurn', () => {
  it('delivers only the matching turnId and unsubscribes cleanly', () => {
    const log = new FakeLog();
    const seen: string[] = [];
    const unsubscribe = subscribeTurn({ log }, asTurnId('own'), (e) => {
      seen.push(e.type === 'assistant_chunk' ? e.delta : '');
    });

    log.emit(chunk('foreign', 'NOPE'));
    log.emit(chunk('own', 'a'));
    log.emit(chunk('own', 'b'));
    unsubscribe();
    log.emit(chunk('own', 'after-unsub'));

    expect(seen).toEqual(['a', 'b']);
  });
});

describe('driveTurn', () => {
  it('forwards turnId, model and signal to runTurn and drains the iterator', async () => {
    const log = new FakeLog();
    let receivedOpts: Record<string, unknown> | undefined;
    let drained = 0;
    const session = {
      log,
      runTurn(_prompt: string, opts: Record<string, unknown>) {
        receivedOpts = opts;
        return (async function* () {
          drained += 1;
          yield message('t1', 'done');
        })();
      },
    };
    const controller = new AbortController();
    await driveTurn(session, {
      turnId: asTurnId('t1'),
      prompt: 'hi',
      model: 'model-x',
      signal: controller.signal,
    });
    expect(drained).toBe(1);
    expect(receivedOpts).toMatchObject({ turnId: 't1', model: 'model-x' });
    expect(receivedOpts?.['signal']).toBe(controller.signal);
  });

  it('omits model when not provided', async () => {
    let receivedOpts: Record<string, unknown> | undefined;
    const session = {
      log: new FakeLog(),
      runTurn(_prompt: string, opts: Record<string, unknown>) {
        receivedOpts = opts;
        return (async function* () {
          // empty turn
        })();
      },
    };
    await driveTurn(session, {
      turnId: asTurnId('t2'),
      prompt: 'hi',
      signal: new AbortController().signal,
    });
    expect(receivedOpts && 'model' in receivedOpts).toBe(false);
  });
});

describe('TurnCoordinator', () => {
  it('grants a single lease at a time (single-flight)', () => {
    const turns = new TurnCoordinator();
    const lease = turns.begin(asTurnId('t1'));
    expect(lease).not.toBeNull();
    expect(turns.busy).toBe(true);
    expect(turns.begin(asTurnId('t2'))).toBeNull();

    lease?.end();
    expect(turns.busy).toBe(false);
    expect(turns.begin(asTurnId('t3'))).not.toBeNull();
  });

  it('exposes the in-flight controller and aborts it on demand', () => {
    const turns = new TurnCoordinator();
    expect(turns.controller).toBeNull();
    turns.abort('noop'); // idle abort is a no-op

    const lease = turns.begin(asTurnId('t1'));
    expect(turns.controller).toBe(lease?.controller);
    turns.abort('shutdown');
    expect(lease?.controller.signal.aborted).toBe(true);

    lease?.end();
    expect(turns.controller).toBeNull();
  });

  it('remembers own turnIds beyond the lease (bounded)', () => {
    const turns = new TurnCoordinator({ maxOwnTurnIds: 2 });
    turns.begin(asTurnId('t1'))?.end();
    turns.begin(asTurnId('t2'))?.end();
    expect(turns.isOwn('t1')).toBe(true);
    expect(turns.isOwn('t2')).toBe(true);
    turns.begin(asTurnId('t3'))?.end();
    // Oldest evicted once the cap is exceeded.
    expect(turns.isOwn('t1')).toBe(false);
    expect(turns.isOwn('t3')).toBe(true);
  });

  it('mirrorText passes only foreign assistant prose while idle', () => {
    const turns = new TurnCoordinator();
    const lease = turns.begin(asTurnId('own'));

    // Own turn: never mirrored, even after the lease ends (invariant #8 —
    // late/replayed events must not be re-mirrored as foreign).
    expect(turns.mirrorText(message('own', 'mine'))).toBeNull();
    // Busy: a foreign turn is not mirrored while we render our own.
    expect(turns.mirrorText(message('foreign', 'other'))).toBeNull();

    lease?.end();
    expect(turns.mirrorText(message('own', 'mine'))).toBeNull();
    expect(turns.mirrorText(message('foreign', 'other'))).toBe('other');
    // Non-message events and empty content are ignored.
    expect(turns.mirrorText(chunk('foreign', 'delta'))).toBeNull();
    expect(turns.mirrorText(message('foreign', '   '))).toBeNull();
  });
});
