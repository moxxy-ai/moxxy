import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchVoiceConnection, type WatchedConnection } from './connection-watch.js';

const GRACE_MS = 15_000;

/** Stand-in for a `@discordjs/voice` connection — the external boundary. */
function fakeConnection() {
  const events = new EventEmitter();
  let status = 'ready';
  const conn = {
    get state() {
      return { status };
    },
    on: (event: 'stateChange', fn: (before: { status: string }, after: { status: string }) => void) => {
      events.on(event, fn);
    },
    off: (event: 'stateChange', fn: (before: { status: string }, after: { status: string }) => void) => {
      events.off(event, fn);
    },
    rejoin: vi.fn(() => true),
    destroy: vi.fn(() => enter('destroyed')),
  } satisfies WatchedConnection;
  const enter = (next: string): void => {
    const before = { status };
    status = next;
    events.emit('stateChange', before, { status });
  };
  return { conn, enter };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a call’s voice connection', () => {
  it('is left alone when it comes back by itself', () => {
    const { conn, enter } = fakeConnection();
    watchVoiceConnection(conn, { graceMs: GRACE_MS });

    enter('disconnected');
    enter('signalling');
    enter('connecting');
    enter('ready');
    vi.advanceTimersByTime(GRACE_MS * 3);

    expect(conn.rejoin).not.toHaveBeenCalled();
    expect(conn.destroy).not.toHaveBeenCalled();
  });

  it('rejoins the channel when it stays stuck reconnecting', () => {
    const { conn, enter } = fakeConnection();
    watchVoiceConnection(conn, { graceMs: GRACE_MS });

    enter('disconnected');
    enter('signalling');
    vi.advanceTimersByTime(GRACE_MS);

    expect(conn.rejoin).toHaveBeenCalledOnce();
    expect(conn.destroy).not.toHaveBeenCalled();
  });

  it('gives up and closes it when rejoining does not bring it back', () => {
    const { conn, enter } = fakeConnection();
    watchVoiceConnection(conn, { graceMs: GRACE_MS });

    enter('signalling');
    vi.advanceTimersByTime(GRACE_MS * 2);

    expect(conn.destroy).toHaveBeenCalledOnce();
  });

  it('tells each change of the connection, for the logs', () => {
    const { conn, enter } = fakeConnection();
    const seen: string[] = [];
    watchVoiceConnection(conn, { graceMs: GRACE_MS, onChange: (from, to) => seen.push(`${from}→${to}`) });

    enter('disconnected');
    enter('ready');

    expect(seen).toEqual(['ready→disconnected', 'disconnected→ready']);
  });
});
