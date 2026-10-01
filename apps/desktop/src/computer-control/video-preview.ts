/** One access unit of the preview video as the `computer-preview` surface sends it: H.264, Annex B, base64. */
export interface VideoChunk {
  seq: number;
  key: boolean;
  codec: string;
  data: string;
  /** Microseconds. */
  timestamp: number;
  width: number;
  height: number;
}

const isSize = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 8192;

export function asVideoChunk(payload: unknown): VideoChunk | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { type, seq, key, codec, data, timestamp, width, height } = payload as Record<string, unknown>;
  if (type !== 'chunk' || typeof seq !== 'number' || typeof key !== 'boolean' || typeof data !== 'string' || typeof timestamp !== 'number') return undefined;
  if (typeof codec !== 'string' || !/^avc1\.[0-9a-f]{6}$/i.test(codec) || !isSize(width) || !isSize(height)) return undefined;
  return { seq, key, codec, data, timestamp, width, height };
}

/** More frames than this waiting in the decoder means the view is falling behind the app. */
export const MAX_DECODE_QUEUE = 3;

/**
 * What to do with the next chunk. A delta is useless without the frames before
 * it, so once one is dropped every delta is dropped until the next key frame.
 */
export function gateChunk(waiting: boolean, key: boolean, queued: number): { decode: boolean; waiting: boolean; askForKey: boolean } {
  if (key) return { decode: true, waiting: false, askForKey: false };
  if (waiting) return { decode: false, waiting: true, askForKey: false };
  if (queued > MAX_DECODE_QUEUE) return { decode: false, waiting: true, askForKey: true };
  return { decode: true, waiting: false, askForKey: false };
}

/** The browser's WebCodecs classes; passed in so the painter does not depend on where they come from. */
export interface VideoCodecs {
  Decoder: typeof VideoDecoder;
  Chunk: typeof EncodedVideoChunk;
}

/** `null` where the browser cannot decode video (the preview then stays on JPEG frames). */
export function browserVideoCodecs(): VideoCodecs | null {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') return null;
  return { Decoder: VideoDecoder, Chunk: EncodedVideoChunk };
}

export interface VideoPainter {
  push(chunk: VideoChunk): void;
  /** Where decoded frames are painted; `null` when the canvas is gone. */
  canvas(element: HTMLCanvasElement | null): void;
  close(): void;
}

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

/** Decodes the preview video and paints it. `askForKey` is called when it cannot go on from where the stream is. */
export function createVideoPainter(codecs: VideoCodecs, askForKey: () => void): VideoPainter {
  let decoder: VideoDecoder | undefined;
  /** Codec and size the decoder was set up for. */
  let stream = '';
  let waiting = true;
  let target: HTMLCanvasElement | null = null;

  const drop = () => {
    const old = decoder;
    decoder = undefined;
    stream = '';
    try { old?.close(); } catch { /* It closed itself when it failed. */ }
  };
  const fail = () => { drop(); waiting = true; askForKey(); };
  const open = (chunk: VideoChunk) => {
    drop();
    const created = new codecs.Decoder({
      output: (frame) => {
        try { target?.getContext('2d')?.drawImage(frame, 0, 0); }
        finally { frame.close(); }
      },
      // An error from a decoder that was already replaced is not news.
      error: () => { if (decoder === created) fail(); },
    });
    created.configure({ codec: chunk.codec, codedWidth: chunk.width, codedHeight: chunk.height, optimizeForLatency: true });
    decoder = created;
    stream = `${chunk.codec} ${chunk.width}x${chunk.height}`;
  };

  return {
    push(chunk) {
      const gate = gateChunk(waiting, chunk.key, decoder?.decodeQueueSize ?? 0);
      waiting = gate.waiting;
      if (gate.askForKey) askForKey();
      if (!gate.decode) return;
      try {
        if (!decoder || stream !== `${chunk.codec} ${chunk.width}x${chunk.height}`) open(chunk);
        decoder?.decode(new codecs.Chunk({ type: chunk.key ? 'key' : 'delta', timestamp: chunk.timestamp, data: bytes(chunk.data) }));
      } catch { fail(); }
    },
    canvas(element) { target = element; },
    close() { drop(); target = null; },
  };
}
