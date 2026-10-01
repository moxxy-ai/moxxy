import { describe, expect, it } from 'vitest';
import { asVideoChunk, createVideoPainter, gateChunk, MAX_DECODE_QUEUE, type VideoCodecs } from './video-preview';

const chunk = (seq: number, key = false, extra: Record<string, unknown> = {}) =>
  ({ type: 'chunk', seq, key, codec: 'avc1.4d001f', data: btoa(`unit${seq}`), timestamp: seq * 200_000, width: 640, height: 400, ...extra });

describe('gateChunk', () => {
  it('waits for a key frame, then decodes everything', () => {
    expect(gateChunk(true, false, 0)).toEqual({ decode: false, waiting: true, askForKey: false });
    expect(gateChunk(true, true, 0)).toEqual({ decode: true, waiting: false, askForKey: false });
    expect(gateChunk(false, false, 0)).toEqual({ decode: true, waiting: false, askForKey: false });
  });

  it('drops deltas once the decoder falls behind and asks for a key frame once', () => {
    expect(gateChunk(false, false, MAX_DECODE_QUEUE + 1)).toEqual({ decode: false, waiting: true, askForKey: true });
    expect(gateChunk(true, false, MAX_DECODE_QUEUE + 1)).toEqual({ decode: false, waiting: true, askForKey: false });
    // A key frame is the way back, however long the queue.
    expect(gateChunk(true, true, MAX_DECODE_QUEUE + 1)).toEqual({ decode: true, waiting: false, askForKey: false });
  });
});

describe('asVideoChunk', () => {
  it('accepts a chunk message and nothing malformed', () => {
    expect(asVideoChunk(chunk(1, true))).toEqual({ seq: 1, key: true, codec: 'avc1.4d001f', data: btoa('unit1'), timestamp: 200_000, width: 640, height: 400 });
    expect(asVideoChunk({ type: 'frame', seq: 1 })).toBeUndefined();
    expect(asVideoChunk(chunk(1, true, { codec: 'vp9' }))).toBeUndefined();
    expect(asVideoChunk(chunk(1, true, { width: 0 }))).toBeUndefined();
    expect(asVideoChunk(chunk(1, true, { data: 7 }))).toBeUndefined();
    expect(asVideoChunk(null)).toBeUndefined();
  });
});

/** Stands in for the browser's WebCodecs, which jsdom does not have. */
function fakeCodecs() {
  const log: string[] = [];
  const decoders: FakeDecoder[] = [];
  class FakeDecoder {
    decodeQueueSize = 0;
    state = 'unconfigured';
    constructor(readonly init: { output: (frame: unknown) => void; error: (error: Error) => void }) { decoders.push(this); log.push('new'); }
    configure(config: { codec: string; codedWidth: number; codedHeight: number; optimizeForLatency: boolean }) {
      this.state = 'configured';
      log.push(`configure ${config.codec} ${config.codedWidth}x${config.codedHeight} latency=${config.optimizeForLatency}`);
    }
    decode(encoded: { type: string; timestamp: number; bytes: string }) { log.push(`decode ${encoded.type} ${encoded.bytes} @${encoded.timestamp}`); }
    close() { this.state = 'closed'; log.push('close'); }
  }
  class FakeChunk {
    readonly type: string; readonly timestamp: number; readonly bytes: string;
    constructor(init: { type: string; timestamp: number; data: Uint8Array }) {
      this.type = init.type; this.timestamp = init.timestamp; this.bytes = new TextDecoder().decode(init.data);
    }
  }
  return { log, decoders, codecs: { Decoder: FakeDecoder, Chunk: FakeChunk } as unknown as VideoCodecs };
}

describe('createVideoPainter', () => {
  it('configures the decoder from the first key frame and decodes what follows', () => {
    const { log, codecs } = fakeCodecs();
    const asked: number[] = [];
    const painter = createVideoPainter(codecs, () => asked.push(1));
    painter.push(asVideoChunk(chunk(1))!);
    expect(log).toEqual([]);
    painter.push(asVideoChunk(chunk(2, true))!);
    painter.push(asVideoChunk(chunk(3))!);
    expect(log).toEqual(['new', 'configure avc1.4d001f 640x400 latency=true', 'decode key unit2 @400000', 'decode delta unit3 @600000']);
    expect(asked).toEqual([]);
    painter.close();
    expect(log.at(-1)).toBe('close');
  });

  it('paints each decoded frame on the canvas and releases it', () => {
    const { decoders, codecs } = fakeCodecs();
    const painter = createVideoPainter(codecs, () => undefined);
    const drawn: unknown[] = [];
    const canvas = { getContext: () => ({ drawImage: (frame: unknown) => drawn.push(frame) }) } as unknown as HTMLCanvasElement;
    painter.canvas(canvas);
    painter.push(asVideoChunk(chunk(1, true))!);
    let closed = 0;
    const frame = { close: () => { closed += 1; } };
    decoders[0]?.init.output(frame);
    expect(drawn).toEqual([frame]);
    painter.canvas(null);
    decoders[0]?.init.output(frame);
    expect(drawn).toEqual([frame]);
    expect(closed).toBe(2);
  });

  it('asks for the picture again when the canvas arrives after the stream began', () => {
    // The canvas is mounted once the first chunk says how big it is; on a still screen no other frame follows.
    const { decoders, codecs } = fakeCodecs();
    const asked: number[] = [];
    const painter = createVideoPainter(codecs, () => asked.push(1));
    const canvas = { getContext: () => ({ drawImage: () => undefined }) } as unknown as HTMLCanvasElement;
    painter.canvas(canvas);
    expect(asked).toEqual([]);
    painter.canvas(null);
    painter.push(asVideoChunk(chunk(1, true))!);
    decoders[0]?.init.output({ close: () => undefined });
    painter.canvas(canvas);
    expect(asked).toEqual([1]);
    painter.canvas(canvas);
    expect(asked).toEqual([1]);
  });

  it('drops deltas while the decoder is behind, asks for a key frame and resumes from it', () => {
    const { log, decoders, codecs } = fakeCodecs();
    const asked: number[] = [];
    const painter = createVideoPainter(codecs, () => asked.push(1));
    painter.push(asVideoChunk(chunk(1, true))!);
    const decoder = decoders[0]!;
    decoder.decodeQueueSize = MAX_DECODE_QUEUE + 1;
    painter.push(asVideoChunk(chunk(2))!);
    painter.push(asVideoChunk(chunk(3))!);
    expect(asked).toEqual([1]);
    decoder.decodeQueueSize = 0;
    painter.push(asVideoChunk(chunk(4))!);
    painter.push(asVideoChunk(chunk(5, true))!);
    expect(log.filter((line) => line.startsWith('decode'))).toEqual(['decode key unit1 @200000', 'decode key unit5 @1000000']);
    expect(decoders).toHaveLength(1);
  });

  it('starts over with a new decoder after a decoding error or a change of the stream', () => {
    const { log, decoders, codecs } = fakeCodecs();
    const asked: number[] = [];
    const painter = createVideoPainter(codecs, () => asked.push(1));
    painter.push(asVideoChunk(chunk(1, true))!);
    decoders[0]?.init.error(new Error('bad data'));
    expect(asked).toEqual([1]);
    painter.push(asVideoChunk(chunk(2))!);
    painter.push(asVideoChunk(chunk(3, true))!);
    // The window was resized: the helper restarted its encoder at another size.
    painter.push(asVideoChunk(chunk(4, true, { width: 800, height: 600 }))!);
    expect(decoders).toHaveLength(3);
    expect(log.filter((line) => line.startsWith('configure'))).toEqual([
      'configure avc1.4d001f 640x400 latency=true', 'configure avc1.4d001f 640x400 latency=true', 'configure avc1.4d001f 800x600 latency=true',
    ]);
    expect(log.filter((line) => line === 'close')).toHaveLength(2);
  });
});
