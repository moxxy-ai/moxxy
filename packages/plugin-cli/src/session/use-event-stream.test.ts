import { describe, expect, it, vi } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';

// Drive the hook without a React renderer, mirroring use-turn-runner.test.ts:
// persistent state/ref cells + a useEffect that runs its body synchronously, so
// the subscribe effect (which seeds `events`) executes during the mount call.
const stateCells: Array<{ value: unknown }> = [];
let stateIdx = 0;
const refCells: Array<{ current: unknown }> = [];
let refIdx = 0;

vi.mock('react', () => {
  const useState = (init: unknown) => {
    const i = stateIdx++;
    if (!stateCells[i]) {
      stateCells[i] = { value: typeof init === 'function' ? (init as () => unknown)() : init };
    }
    const cell = stateCells[i]!;
    const setter = (next: unknown) => {
      cell.value = typeof next === 'function' ? (next as (p: unknown) => unknown)(cell.value) : next;
    };
    return [cell.value, setter];
  };
  const useRef = (init: unknown) => {
    const i = refIdx++;
    if (!refCells[i]) refCells[i] = { current: init };
    return refCells[i]!;
  };
  const useEffect = (fn: () => void | (() => void)) => {
    // Run the effect body now (mount). Ignore the returned cleanup.
    fn();
  };
  const useCallback = (fn: unknown) => fn;
  return { useState, useRef, useEffect, useCallback, default: { useState, useRef, useEffect, useCallback } };
});

const { useEventStream, seedFromLog } = await import('./use-event-stream.js');

const ev = (type: string, extra: Record<string, unknown> = {}): MoxxyEvent =>
  ({ type, ...extra }) as unknown as MoxxyEvent;

/** A minimal session whose log mirrors core's EventLog seed+subscribe surface. */
function fakeSession(held: ReadonlyArray<MoxxyEvent>) {
  let listener: ((e: MoxxyEvent) => void) | null = null;
  const live = [...held];
  return {
    session: {
      log: {
        toJSON: () => [...live],
        // Seeded events do NOT fire subscribers (matches core EventLog) — only
        // events pushed AFTER subscribe reach the listener.
        subscribe: (fn: (e: MoxxyEvent) => void) => {
          listener = fn;
          return () => {
            listener = null;
          };
        },
      },
    } as unknown as Parameters<typeof useEventStream>[0],
    append: (e: MoxxyEvent) => {
      live.push(e);
      listener?.(e);
    },
  };
}

function mount(session: Parameters<typeof useEventStream>[0]) {
  stateCells.length = 0;
  stateIdx = 0;
  refCells.length = 0;
  refIdx = 0;
  return useEventStream(session);
}

// `events` is the first useState in the hook → stateCells[0].
const renderedEvents = () => stateCells[0]!.value as ReadonlyArray<MoxxyEvent>;

describe('seedFromLog', () => {
  it('returns the held events, dropping live-only chunk types', () => {
    const seeded = seedFromLog({
      toJSON: () => [
        ev('user_message'),
        ev('assistant_chunk'),
        ev('reasoning_chunk'),
        ev('assistant_message'),
      ],
    });
    expect(seeded.map((e) => e.type)).toEqual(['user_message', 'assistant_message']);
  });

  it('tail-caps a very long history to the in-memory window', () => {
    const many = Array.from({ length: 5_200 }, (_, i) => ev('user_message', { i }));
    const seeded = seedFromLog({ toJSON: () => many });
    expect(seeded).toHaveLength(5_000);
    // Keeps the most recent tail.
    expect((seeded[seeded.length - 1] as { i: number }).i).toBe(5_199);
  });

  it('an empty log seeds nothing', () => {
    expect(seedFromLog({ toJSON: () => [] })).toEqual([]);
  });
});

describe('useEventStream seeding (session switch / resume)', () => {
  it('seeds the renderer from history the log already holds on mount', () => {
    // The regression: a switched-to / resumed session whose EventLog is already
    // populated rendered an EMPTY body because the hook only listened for future
    // appends. It must now show the prior messages.
    const { session } = fakeSession([ev('user_message'), ev('assistant_message')]);
    mount(session);
    expect(renderedEvents().map((e) => e.type)).toEqual(['user_message', 'assistant_message']);
  });

  it('a fresh (empty) session still starts empty', () => {
    const { session } = fakeSession([]);
    mount(session);
    expect(renderedEvents()).toEqual([]);
  });

  it('appends live events after the seed without dropping or duplicating it', () => {
    const { session, append } = fakeSession([ev('user_message')]);
    mount(session);
    append(ev('assistant_message'));
    expect(renderedEvents().map((e) => e.type)).toEqual(['user_message', 'assistant_message']);
  });
});
