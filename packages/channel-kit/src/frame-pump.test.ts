import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FramePump, type FrameSink } from './frame-pump.js';

interface SinkCall {
  readonly op: 'send' | 'edit';
  readonly id?: number;
  readonly text: string;
  readonly final: boolean;
}

function makeSink(opts: { failSends?: boolean } = {}): { sink: FrameSink<number>; calls: SinkCall[] } {
  const calls: SinkCall[] = [];
  let nextId = 0;
  const sink: FrameSink<number> = {
    async send(text, final) {
      calls.push({ op: 'send', text, final });
      if (opts.failSends) return null;
      return ++nextId;
    },
    async edit(id, text, final) {
      calls.push({ op: 'edit', id, text, final });
    },
  };
  return { sink, calls };
}

describe('FramePump', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the first frame, then edits the same message for later frames', async () => {
    const { sink, calls } = makeSink();
    let text = '';
    const pump = new FramePump<number>({ sink, editFrameMs: 1000, frame: () => text });

    text = 'Hello';
    pump.scheduleEdit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([{ op: 'send', text: 'Hello', final: false }]);
    expect(pump.messageId).toBe(1);

    text = 'Hello, world';
    pump.scheduleEdit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls[1]).toEqual({ op: 'edit', id: 1, text: 'Hello, world', final: false });
  });

  it('throttles edits: many schedules inside one window produce one flush', async () => {
    const { sink, calls } = makeSink();
    let text = '';
    const pump = new FramePump<number>({ sink, editFrameMs: 1000, frame: () => text });

    for (const t of ['a', 'ab', 'abc', 'abcd']) {
      text = t;
      pump.scheduleEdit();
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1000);
    // One send carrying the newest text at flush time — not four.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe('abcd');
  });

  it('skips a flush whose frame is unchanged', async () => {
    const { sink, calls } = makeSink();
    const pump = new FramePump<number>({ sink, editFrameMs: 1000, frame: () => 'same' });

    await pump.flush(false);
    await pump.flush(false);
    await pump.flush(true);
    expect(calls).toHaveLength(1);
  });

  it('alwaysFlushFinal delivers the final frame to the sink even when unchanged', async () => {
    const { sink, calls } = makeSink();
    const pump = new FramePump<number>({
      sink,
      editFrameMs: 1000,
      frame: () => 'same',
      alwaysFlushFinal: true,
    });

    await pump.flush(false);
    await pump.flush(true);
    expect(calls).toEqual([
      { op: 'send', text: 'same', final: false },
      { op: 'edit', id: 1, text: 'same', final: true },
    ]);
  });

  it('posts emptyFinalText when a final flush finds no content and nothing was sent', async () => {
    const { sink, calls } = makeSink();
    const pump = new FramePump<number>({
      sink,
      editFrameMs: 1000,
      frame: () => '',
      emptyFinalText: '(no output)',
    });

    await pump.flush(false); // mid-stream empty → nothing
    expect(calls).toHaveLength(0);
    await pump.flush(true);
    expect(calls).toEqual([{ op: 'send', text: '(no output)', final: true }]);
  });

  it('does not post emptyFinalText when a message was already sent', async () => {
    const { sink, calls } = makeSink();
    let text = 'content';
    const pump = new FramePump<number>({
      sink,
      editFrameMs: 1000,
      frame: () => text,
      emptyFinalText: '(no output)',
    });

    await pump.flush(false);
    text = '';
    await pump.flush(true);
    expect(calls).toEqual([{ op: 'send', text: 'content', final: false }]);
  });

  it('retries as a fresh send when the first send failed (id stays null)', async () => {
    const failing = makeSink({ failSends: true });
    let text = 'one';
    const pump = new FramePump<number>({
      sink: failing.sink,
      editFrameMs: 1000,
      frame: () => text,
    });
    await pump.flush(false);
    expect(pump.messageId).toBeNull();

    text = 'two';
    await pump.flush(false);
    // Still a send (never an edit on a null id).
    expect(failing.calls.map((c) => c.op)).toEqual(['send', 'send']);
  });

  it('a final flush waits out an in-flight send instead of being dropped', async () => {
    const calls: SinkCall[] = [];
    let text = 'streamed';
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sink: FrameSink<number> = {
      async send(t, final) {
        calls.push({ op: 'send', text: t, final });
        await gate; // hold the first send in flight
        return 1;
      },
      async edit(id, t, final) {
        calls.push({ op: 'edit', id, text: t, final });
      },
    };
    const pump = new FramePump<number>({ sink, editFrameMs: 1000, frame: () => text });

    const first = pump.flush(false); // in flight, parked on the gate
    text = 'streamed + final';
    const final = pump.flush(true); // must wait, then deliver the final text
    release?.();
    await first;
    await final;

    expect(calls).toEqual([
      { op: 'send', text: 'streamed', final: false },
      { op: 'edit', id: 1, text: 'streamed + final', final: true },
    ]);
  });

  it('re-arms the timer when content advances during a send', async () => {
    const calls: SinkCall[] = [];
    let text = 'v1';
    let sends = 0;
    const sink: FrameSink<number> = {
      async send(t, final) {
        calls.push({ op: 'send', text: t, final });
        sends += 1;
        if (sends === 1) text = 'v2'; // new content lands mid-send
        return sends;
      },
      async edit(id, t, final) {
        calls.push({ op: 'edit', id, text: t, final });
      },
    };
    const pump = new FramePump<number>({ sink, editFrameMs: 1000, frame: () => text });

    await pump.flush(false);
    // The pump noticed the newer frame and re-armed its own timer.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([
      { op: 'send', text: 'v1', final: false },
      { op: 'edit', id: 1, text: 'v2', final: false },
    ]);
  });

  it('dispose cancels a pending edit', async () => {
    const { sink, calls } = makeSink();
    const pump = new FramePump<number>({ sink, editFrameMs: 1000, frame: () => 'x' });
    pump.scheduleEdit();
    pump.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(0);
  });
});
