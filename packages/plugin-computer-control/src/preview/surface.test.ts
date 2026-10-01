import { describe, expect, it } from 'vitest';
import { PreviewController, type PreviewSource } from './controller.js';
import { COMPUTER_PREVIEW_SURFACE, buildComputerPreviewSurface } from './surface.js';

const helper = (calls: string[], codecs: PreviewSource['codecs'] = ['jpeg']): PreviewSource => ({
  codecs,
  start: async (fps, codec) => { calls.push(codec === 'jpeg' ? `start ${fps}` : `start ${fps} ${codec}`); },
  stop: async () => { calls.push('stop'); },
  keyframe: async () => { calls.push('keyframe'); },
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('computer-preview surface', () => {
  it('is the viewer of the preview: opening it starts frames, closing it stops them', async () => {
    const controller = new PreviewController();
    const calls: string[] = [];
    const source = helper(calls);
    controller.attach(source);
    const surface = buildComputerPreviewSurface(controller);
    expect(surface.kind).toBe(COMPUTER_PREVIEW_SURFACE);
    const instance = await surface.open({ cwd: process.cwd() });
    const payloads: unknown[] = [];
    const off = instance.onData((payload) => payloads.push(payload));
    await settle();
    expect(calls).toEqual(['start 2']);
    controller.frame(source, { mediaType: 'image/jpeg', base64: 'a', width: 2, height: 1 });
    expect(payloads.at(-1)).toEqual({ type: 'frame', seq: 1, image: { mediaType: 'image/jpeg', base64: 'a', width: 2, height: 1 } });
    expect(instance.snapshot?.()).toEqual({ state: 'live', frame: { seq: 1, image: { mediaType: 'image/jpeg', base64: 'a', width: 2, height: 1 } } });
    off();
    await instance.close();
    await settle();
    expect(calls).toEqual(['start 2', 'stop']);
  });

  it('lets the viewer choose the frame rate and ignores anything else it sends', async () => {
    const controller = new PreviewController();
    const calls: string[] = [];
    controller.attach(helper(calls));
    const instance = await buildComputerPreviewSurface(controller).open({ cwd: process.cwd() });
    instance.onData(() => undefined);
    await settle();
    await instance.input({ type: 'configure', fps: 4 });
    await instance.input({ type: 'configure', fps: 'fast' });
    await instance.input({ type: 'click', x: 1, y: 1 });
    await settle();
    expect(calls).toEqual(['start 2', 'start 4']);
  });

  it('switches to video for a viewer that can decode it and passes on its request for a key frame', async () => {
    const controller = new PreviewController();
    const calls: string[] = [];
    const source = helper(calls, ['h264', 'jpeg']);
    controller.attach(source);
    const instance = await buildComputerPreviewSurface(controller).open({ cwd: process.cwd() });
    const payloads: unknown[] = [];
    instance.onData((payload) => payloads.push(payload));
    await settle();
    await instance.input({ type: 'configure', codecs: ['h264', 'jpeg'] });
    await settle();
    expect(calls).toEqual(['start 2', 'start 2 h264']);
    controller.chunk(source, { seq: 1, key: true, codec: 'avc1.4d001f', data: 'AAAA', timestamp: 0, width: 640, height: 400 });
    expect(payloads.at(-1)).toEqual({ type: 'chunk', seq: 1, key: true, codec: 'avc1.4d001f', data: 'AAAA', timestamp: 0, width: 640, height: 400 });
    await instance.input({ type: 'keyframe' });
    await instance.input({ type: 'configure', codecs: ['vp9', 7] });
    await settle();
    expect(calls).toEqual(['start 2', 'start 2 h264', 'keyframe', 'start 2']);
  });
});
