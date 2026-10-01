import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewController, type PreviewChunk, type PreviewCodec, type PreviewImage, type PreviewMessage, type PreviewSource } from './controller.js';

const image = (label: string): PreviewImage => ({ mediaType: 'image/jpeg', base64: label, width: 640, height: 400 });

/** A producer that records what it was asked to do; `start` can be made to fail. */
function source(fail?: string, codecs: readonly PreviewCodec[] = ['jpeg']): PreviewSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    codecs,
    start: async (fps, codec) => { calls.push(codec === 'jpeg' ? `start ${fps}` : `start ${fps} ${codec}`); if (fail) throw new Error(fail); },
    stop: async () => { calls.push('stop'); },
    keyframe: async () => { calls.push('keyframe'); },
  };
}
const video = () => source(undefined, ['h264', 'jpeg']);
const chunk = (seq: number, key = false): PreviewChunk => ({ seq, key, codec: 'avc1.4d001f', data: `chunk${seq}`, timestamp: seq * 200_000, width: 640, height: 400 });
const chunks = (messages: PreviewMessage[]) => messages.flatMap((message) => (message.type === 'chunk' ? [message.data] : []));

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

describe('PreviewController video', () => {
  const watch = (controller: PreviewController, codecs?: readonly PreviewCodec[]) => {
    const messages: PreviewMessage[] = [];
    const listener = (message: PreviewMessage) => { messages.push(message); };
    return { messages, listener, leave: controller.subscribe(listener, codecs) };
  };

  it('uses video only when the helper makes it and every viewer can show it', async () => {
    const controller = new PreviewController();
    const helper = video();
    controller.attach(helper);
    const modern = watch(controller, ['h264', 'jpeg']);
    await vi.advanceTimersByTimeAsync(0);
    // A new encoder starts with a key frame by itself.
    expect(helper.calls).toEqual(['start 2 h264']);
    // A viewer that only shows pictures joins: everyone gets pictures.
    const plain = watch(controller);
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls.at(-1)).toBe('start 2');
    plain.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls).toEqual(['start 2 h264', 'start 2', 'start 2 h264']);
    modern.leave();
  });

  it('keeps pictures when the helper has no video', async () => {
    const controller = new PreviewController();
    const helper = source();
    controller.attach(helper);
    watch(controller, ['h264', 'jpeg']);
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls).toEqual(['start 2']);
  });

  it('lets a viewer say later what it can show', async () => {
    const controller = new PreviewController();
    const helper = video();
    controller.attach(helper);
    const late = watch(controller);
    await vi.advanceTimersByTimeAsync(0);
    controller.accept(late.listener, ['h264', 'jpeg']);
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls).toEqual(['start 2', 'start 2 h264']);
  });

  it('gives a viewer nothing until a key frame, then every chunk in order', async () => {
    const controller = new PreviewController();
    const helper = video();
    controller.attach(helper);
    const first = watch(controller, ['h264']);
    await vi.advanceTimersByTimeAsync(0);
    controller.chunk(helper, chunk(1));
    expect(chunks(first.messages)).toEqual([]);
    controller.chunk(helper, chunk(2, true));
    controller.chunk(helper, chunk(3));
    expect(chunks(first.messages)).toEqual(['chunk2', 'chunk3']);
    expect(states(first.messages).at(-1)).toBe('live');
    // A second viewer joins in the middle of the stream: it waits for its own key frame.
    const second = watch(controller, ['h264']);
    await vi.advanceTimersByTimeAsync(0);
    expect(helper.calls.at(-1)).toBe('keyframe');
    controller.chunk(helper, chunk(4));
    expect(chunks(first.messages)).toEqual(['chunk2', 'chunk3', 'chunk4']);
    expect(chunks(second.messages)).toEqual([]);
    controller.chunk(helper, chunk(5, true));
    expect(chunks(second.messages)).toEqual(['chunk5']);
    expect(controller.snapshot()).toEqual({ state: 'live' });
  });

  it('drops deltas after a lost chunk until the next key frame and asks for one', async () => {
    const controller = new PreviewController();
    const helper = video();
    controller.attach(helper);
    const only = watch(controller, ['h264']);
    await vi.advanceTimersByTimeAsync(0);
    controller.chunk(helper, chunk(1, true));
    controller.chunk(helper, chunk(2));
    helper.calls.length = 0;
    controller.chunk(helper, chunk(4));
    controller.chunk(helper, chunk(5));
    expect(chunks(only.messages)).toEqual(['chunk1', 'chunk2']);
    expect(helper.calls).toEqual(['keyframe']);
    controller.chunk(helper, chunk(6, true));
    controller.chunk(helper, chunk(7));
    expect(chunks(only.messages)).toEqual(['chunk1', 'chunk2', 'chunk6', 'chunk7']);
  });

  it('starts a viewer that fell behind again from a key frame', async () => {
    const controller = new PreviewController();
    const helper = video();
    controller.attach(helper);
    const slow = watch(controller, ['h264']);
    const other = watch(controller, ['h264']);
    await vi.advanceTimersByTimeAsync(0);
    controller.chunk(helper, chunk(1, true));
    helper.calls.length = 0;
    controller.keyframe(slow.listener);
    expect(helper.calls).toEqual(['keyframe']);
    controller.chunk(helper, chunk(2));
    expect(chunks(slow.messages)).toEqual(['chunk1']);
    expect(chunks(other.messages)).toEqual(['chunk1', 'chunk2']);
    controller.chunk(helper, chunk(3, true));
    expect(chunks(slow.messages)).toEqual(['chunk1', 'chunk3']);
  });

  it('goes stale when chunks stop, like pictures do', async () => {
    const controller = new PreviewController({ staleAfterMs: 500 });
    const helper = video();
    controller.attach(helper);
    const only = watch(controller, ['h264']);
    await vi.advanceTimersByTimeAsync(0);
    controller.chunk(helper, chunk(1, true));
    await vi.advanceTimersByTimeAsync(600);
    expect(states(only.messages).at(-1)).toBe('stale');
  });
});
