import { describe, expect, it, vi } from 'vitest';

// Drive the hook without a React renderer by mocking react's useState/useRef
// with deterministic, persistent implementations. The hook is mounted ONCE
// per test and then driven imperatively — which is exactly the production
// scenario the stale-closure bug lives in: the in-flight turn was started by
// the closure created at mount, where `priorityMessage` was still null. A
// mid-turn force-send updates state but does NOT re-run the closure, so any
// drain logic that reads the lexical `priorityMessage` (rather than a ref)
// sees the stale null and never runs the force-sent message.
const stateCells: Array<{ value: unknown }> = [];
let stateIdx = 0;
const refCells: Array<{ current: unknown }> = [];
let refIdx = 0;

vi.mock('react', () => ({
  useState: (init: unknown) => {
    const i = stateIdx++;
    if (!stateCells[i]) {
      stateCells[i] = { value: typeof init === 'function' ? (init as () => unknown)() : init };
    }
    const cell = stateCells[i]!;
    const setter = (next: unknown) => {
      cell.value = typeof next === 'function' ? (next as (p: unknown) => unknown)(cell.value) : next;
    };
    return [cell.value, setter];
  },
  useRef: (init: unknown) => {
    const i = refIdx++;
    if (!refCells[i]) refCells[i] = { current: init };
    return refCells[i]!;
  },
}));

const { useTurnRunner } = await import('./use-turn-runner.js');

function mountFreshHook(opts: Parameters<typeof useTurnRunner>[0]) {
  stateCells.length = 0;
  stateIdx = 0;
  refCells.length = 0;
  refIdx = 0;
  return useTurnRunner(opts);
}

function makeStream() {
  return {
    cancelStreamFlush: () => {},
    streamingBufferRef: { current: '' },
    setStreamingDelta: () => {},
  } as unknown as Parameters<typeof useTurnRunner>[0]['stream'];
}

describe('useTurnRunner force-send drain (u79-1)', () => {
  it('runs a mid-turn force-sent message alone after the in-flight turn', async () => {
    const runs: string[] = [];
    // Controllable gate so we can force-send WHILE the first turn is in flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const session = {
      runTurn: (text: string) => {
        runs.push(text);
        return (async function* () {
          // The first turn (text 'A') blocks on the gate so the test can
          // force-send before it completes.
          if (text === 'A') await gate;
        })();
      },
    } as unknown as Parameters<typeof useTurnRunner>[0]['session'];

    const handle = mountFreshHook({
      session,
      resolveModel: () => undefined,
      stream: makeStream(),
    });

    // Start the first turn (it parks on the gate).
    const turnPromise = handle.runTurnWith('A', []);

    // User queues a message, then force-sends it WHILE 'A' is in flight.
    handle.queueRef.current.push({ text: 'B', attachments: [] });
    expect(handle.forceSendFirst()).toBe(true);
    // It moved out of the queue into the priority slot.
    expect(handle.queueRef.current.length).toBe(0);

    // Let the in-flight turn finish; its finally must drain the priority slot.
    release();
    await turnPromise;

    expect(runs).toEqual(['A', 'B']);
  });

  it('drains the queue (not priority) when nothing was force-sent', async () => {
    const runs: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const session = {
      runTurn: (text: string) => {
        runs.push(text);
        return (async function* () {
          if (text === 'A') await gate;
        })();
      },
    } as unknown as Parameters<typeof useTurnRunner>[0]['session'];

    const handle = mountFreshHook({
      session,
      resolveModel: () => undefined,
      stream: makeStream(),
    });

    const turnPromise = handle.runTurnWith('A', []);
    handle.queueRef.current.push({ text: 'B', attachments: [] });
    handle.queueRef.current.push({ text: 'C', attachments: [] });
    release();
    await turnPromise;

    // Queue concatenates into one follow-up turn.
    expect(runs).toEqual(['A', 'B\n\nC']);
  });

  it('splits a huge queued message across turns instead of one oversized prompt', async () => {
    const runs: string[] = [];
    const notices: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const session = {
      runTurn: (text: string) => {
        runs.push(text);
        return (async function* () {
          if (text === 'A') await gate;
        })();
      },
    } as unknown as Parameters<typeof useTurnRunner>[0]['session'];

    const handle = mountFreshHook({
      session,
      resolveModel: () => undefined,
      stream: makeStream(),
      onNotice: (m: string) => notices.push(m),
    });

    const turnPromise = handle.runTurnWith('A', []);
    // Two messages, each well over the 200k char drain ceiling. They must NOT
    // merge into a single multi-hundred-KB prompt — the first drains now, the
    // second follows on the next turn.
    const big = 'x'.repeat(150_000);
    handle.queueRef.current.push({ text: big, attachments: [] });
    handle.queueRef.current.push({ text: big, attachments: [] });
    release();
    await turnPromise;

    expect(runs).toEqual(['A', big, big]);
    expect(notices.some((n) => /will follow/.test(n))).toBe(true);
  });
});
