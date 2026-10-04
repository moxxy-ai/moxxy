import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPointer, glideMs, type CursorFrame } from './agent-pointer.js';

describe('glideMs', () => {
  it('appears in place the first time, with nothing to glide from', () => {
    expect(glideMs(undefined, { x: 300, y: 200 })).toBe(0);
  });

  it('takes longer for a longer way, between the same bounds as the Computer Use cursor', () => {
    expect(glideMs({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(100);
    expect(glideMs({ x: 0, y: 0 }, { x: 300, y: 400 })).toBe(250);
    const short = glideMs({ x: 0, y: 0 }, { x: 60, y: 80 });
    expect(short).toBeGreaterThan(100);
    expect(short).toBeLessThan(250);
  });
});

describe('AgentPointer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('moves at once when no pane is drawing it', async () => {
    const pointer = new AgentPointer();
    await expect(pointer.moveTo('t1', { x: 10, y: 20 })).resolves.toBeUndefined();
  });

  it('tells the pane where to glide and waits until the pane says it arrived', async () => {
    const frames: CursorFrame[] = [];
    const pointer = new AgentPointer();
    await pointer.moveTo('t1', { x: 10, y: 20 });
    pointer.setSink((frame) => frames.push(frame));

    let arrived = false;
    const move = pointer.moveTo('t1', { x: 70, y: 100 }).then(() => {
      arrived = true;
    });
    expect(frames).toEqual([
      { requestId: expect.any(String), tabId: 't1', cursor: { x: 70, y: 100, phase: 'moving', durationMs: 130 } },
    ]);
    await vi.advanceTimersByTimeAsync(100);
    expect(arrived).toBe(false);

    pointer.arrived(frames[0]?.requestId ?? '');
    await move;
    expect(arrived).toBe(true);
  });

  it('goes ahead at the deadline when the pane never answers', async () => {
    const pointer = new AgentPointer();
    await pointer.moveTo('t1', { x: 0, y: 0 });
    pointer.setSink(() => {});
    const move = pointer.moveTo('t1', { x: 300, y: 400 });
    await vi.advanceTimersByTimeAsync(250 + 500);
    await expect(move).resolves.toBeUndefined();
  });

  it('marks the press where the pointer stands, and failure in its own colour', async () => {
    const frames: CursorFrame[] = [];
    const pointer = new AgentPointer();
    pointer.setSink((frame) => frames.push(frame));
    const move = pointer.moveTo('t1', { x: 5, y: 6 });
    pointer.arrived(frames[0]?.requestId ?? '');
    await move;

    pointer.finish('t1', true);
    pointer.finish('t1', false);
    expect(frames.slice(1).map((frame) => frame.cursor)).toEqual([
      { x: 5, y: 6, phase: 'delivered', durationMs: 0 },
      { x: 5, y: 6, phase: 'failed', durationMs: 0 },
    ]);
  });

  it('marks nothing on a tab it never moved on', () => {
    const frames: CursorFrame[] = [];
    const pointer = new AgentPointer();
    pointer.setSink((frame) => frames.push(frame));
    pointer.finish('t9', true);
    expect(frames).toEqual([]);
  });

  it('leaves the page when hidden, and appears in place again afterwards', async () => {
    const frames: CursorFrame[] = [];
    const pointer = new AgentPointer();
    pointer.setSink((frame) => {
      frames.push(frame);
      if (frame.cursor) pointer.arrived(frame.requestId);
    });
    await pointer.moveTo('t1', { x: 5, y: 6 });
    pointer.hideAll();
    expect(frames.at(-1)).toEqual({ requestId: expect.any(String), tabId: 't1', cursor: null });

    await pointer.moveTo('t1', { x: 50, y: 60 });
    expect(frames.at(-1)?.cursor).toEqual({ x: 50, y: 60, phase: 'moving', durationMs: 0 });
  });
});
