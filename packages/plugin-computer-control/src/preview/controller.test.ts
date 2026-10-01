import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewController, type PreviewImage, type PreviewMessage, type PreviewSource } from './controller.js';

const image = (label: string): PreviewImage => ({ mediaType: 'image/jpeg', base64: label, width: 640, height: 400 });

/** A producer that records what it was asked to do; `start` can be made to fail. */
function source(fail?: string): PreviewSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: async (fps) => { calls.push(`start ${fps}`); if (fail) throw new Error(fail); },
    stop: async () => { calls.push('stop'); },
  };
}

function viewer(controller: PreviewController): { messages: PreviewMessage[]; leave: () => void } {
  const messages: PreviewMessage[] = [];
  return { messages, leave: controller.subscribe((message) => messages.push(message)) };
}
const frames = (messages: PreviewMessage[]) => messages.flatMap((message) => (message.type === 'frame' ? [message.image.base64] : []));
const states = (messages: PreviewMessage[]) => messages.flatMap((message) => (message.type === 'state' ? [message.state] : []));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('PreviewController', () => {
  it('produces frames only while someone watches a running turn', async () => {
    const controller = new PreviewController();
    const helper = source();
    controller.attach(helper);
    expect(helper.calls).toEqual([]);
    const first = viewer(controller);
    const second = viewer(controller);
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls).toEqual(['start 2']);
    first.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls).toEqual(['start 2']);
    second.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls).toEqual(['start 2', 'stop']);
  });

  it('starts the producer when a turn begins while a viewer is already waiting', async () => {
    const controller = new PreviewController();
    const watching = viewer(controller);
    expect(states(watching.messages)).toEqual(['stopped']);
    const helper = source();
    controller.attach(helper);
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls).toEqual(['start 2']);
    controller.frame(helper, image('a'));
    expect(states(watching.messages)).toEqual(['stopped', 'live']);
    expect(frames(watching.messages)).toEqual(['a']);
  });

  it('keeps only the latest frame when frames arrive faster than the viewer rate', async () => {
    const controller = new PreviewController({ fps: 2 });
    const helper = source();
    controller.attach(helper);
    const watching = viewer(controller);
    for (const label of ['a', 'b', 'c', 'd']) controller.frame(helper, image(label));
    expect(frames(watching.messages)).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(500);
    expect(frames(watching.messages)).toEqual(['a', 'd']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(frames(watching.messages)).toEqual(['a', 'd']);
  });

  it('turns stale when the producer goes quiet and live again with its next sign of life', async () => {
    const controller = new PreviewController({ staleAfterMs: 3000 });
    const helper = source();
    controller.attach(helper);
    const watching = viewer(controller);
    controller.frame(helper, image('a'));
    await vi.advanceTimersByTimeAsync(2000);
    controller.frame(helper, undefined);
    await vi.advanceTimersByTimeAsync(2000);
    expect(states(watching.messages)).toEqual(['stopped', 'live']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(states(watching.messages)).toEqual(['stopped', 'live', 'stale']);
    controller.frame(helper, undefined);
    expect(states(watching.messages)).toEqual(['stopped', 'live', 'stale', 'live']);
    expect(frames(watching.messages)).toEqual(['a']);
  });

  it('says why there is no picture when the producer cannot start or fails', async () => {
    const controller = new PreviewController();
    const watching = viewer(controller);
    controller.attach(source('Screen Recording is not allowed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(watching.messages.at(-1)).toEqual({ type: 'state', state: 'unavailable', reason: 'Screen Recording is not allowed' });
    const helper = source();
    controller.attach(helper);
    await vi.advanceTimersByTimeAsync(0);
    controller.failed(helper, 'The window closed');
    expect(watching.messages.at(-1)).toEqual({ type: 'state', state: 'unavailable', reason: 'The window closed' });
  });

  it('stops and forgets the picture when the turn ends, so nothing of it is shown afterwards', async () => {
    const controller = new PreviewController();
    const helper = source();
    const detach = controller.attach(helper);
    const watching = viewer(controller);
    controller.frame(helper, image('a'));
    detach();
    await vi.advanceTimersByTimeAsync(0);
    expect(watching.messages.at(-1)).toEqual({ type: 'state', state: 'stopped' });
    expect(controller.snapshot()).toEqual({ state: 'stopped' });
    // The helper is gone with its turn; it is not asked to stop, and its late frames are dropped.
    expect(helper.calls).toEqual(['start 2']);
    controller.frame(helper, image('late'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(frames(watching.messages)).toEqual(['a']);
    expect(states(watching.messages).at(-1)).toBe('stopped');
  });

  it('gives a late viewer the current state and the latest frame at once', async () => {
    const controller = new PreviewController();
    const helper = source();
    controller.attach(helper);
    viewer(controller);
    controller.frame(helper, image('a'));
    const late = viewer(controller);
    expect(late.messages).toEqual([{ type: 'state', state: 'live' }, { type: 'frame', seq: 1, image: image('a') }]);
    expect(controller.snapshot()).toEqual({ state: 'live', frame: { seq: 1, image: image('a') } });
  });

  it('follows the newest turn and ignores frames of an older one', async () => {
    const controller = new PreviewController();
    const older = source();
    const newer = source();
    controller.attach(older);
    const watching = viewer(controller);
    await vi.advanceTimersByTimeAsync(0);
    controller.attach(newer);
    await vi.advanceTimersByTimeAsync(0);
    expect(older.calls).toEqual(['start 2', 'stop']);
    expect(newer.calls).toEqual(['start 2']);
    controller.frame(older, image('old'));
    controller.frame(newer, image('new'));
    expect(frames(watching.messages)).toEqual(['new']);
  });

  it('keeps the frame rate between 1 and 5 and restarts a running producer at the new rate', async () => {
    const controller = new PreviewController();
    const helper = source();
    controller.attach(helper);
    viewer(controller);
    await vi.advanceTimersByTimeAsync(0);
    controller.setFps(30);
    await vi.advanceTimersByTimeAsync(0);
    controller.setFps(0);
    await vi.advanceTimersByTimeAsync(0);
    controller.setFps(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls).toEqual(['start 2', 'start 5', 'start 1']);
  });
});
