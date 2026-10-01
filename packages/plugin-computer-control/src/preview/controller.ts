/** What the human sees of the app the agent works in. Never shown to the model or written to the session log. */
export interface PreviewImage {
  readonly mediaType: 'image/jpeg';
  readonly base64: string;
  readonly width: number;
  readonly height: number;
}

/**
 * `live`: frames are current. `stale`: the producer went quiet. `unavailable`:
 * it cannot produce (with the reason). `stopped`: no turn is using the computer.
 */
export type PreviewState = 'live' | 'stale' | 'unavailable' | 'stopped';

/** How the picture travels: single JPEG frames, or an H.264 stream for viewers that can decode one. */
export type PreviewCodec = 'jpeg' | 'h264';
const isCodec = (value: unknown): value is PreviewCodec => value === 'jpeg' || value === 'h264';
/** The codecs in `value` this controller knows; anything else in the list is ignored. */
export const previewCodecs = (value: unknown): PreviewCodec[] => (Array.isArray(value) ? value.filter(isCodec) : []);

/** One access unit of the video, Annex B, base64. A key chunk decodes without anything before it. */
export interface PreviewChunk {
  readonly seq: number;
  readonly key: boolean;
  /** RFC 6381 codec string, e.g. `avc1.4d001f`. */
  readonly codec: string;
  readonly data: string;
  /** Microseconds. */
  readonly timestamp: number;
  readonly width: number;
  readonly height: number;
}

export type PreviewMessage =
  | { readonly type: 'frame'; readonly seq: number; readonly image: PreviewImage }
  | ({ readonly type: 'chunk' } & PreviewChunk)
  | { readonly type: 'state'; readonly state: PreviewState; readonly reason?: string };

export interface PreviewSnapshot {
  readonly state: PreviewState;
  readonly reason?: string;
  readonly frame?: { readonly seq: number; readonly image: PreviewImage };
}

/** One turn's helper, as far as the preview is concerned. `start` on a running producer changes its rate. */
export interface PreviewSource {
  /** What this helper can produce. */
  readonly codecs: readonly PreviewCodec[];
  start(fps: number, codec: PreviewCodec): Promise<void>;
  stop(): Promise<void>;
  /** Make the next chunk a key frame. */
  keyframe(): Promise<void>;
}

/** Pictures a second. Video is smooth; single pictures are each a whole JPEG, so they stay slow. */
export const PREVIEW_FPS = { h264: { default: 30, max: 30 }, jpeg: { default: 2, max: 5 }, min: 1 } as const;

type Listener = (message: PreviewMessage) => void;
interface Viewer {
  /** What this viewer can show. */
  codecs: readonly PreviewCodec[];
  /** In a video stream: nothing is sent to it until the next key frame. */
  waiting: boolean;
}

/**
 * Connects the viewers of the preview to the helper of the turn that is using
 * the computer. The helper captures only while someone watches; viewers get the
 * latest frame at the chosen rate, never a backlog. Video is used when the
 * helper makes it and every viewer can decode it; a viewer that cannot follow
 * the stream gets nothing until the next key frame.
 */
export class PreviewController {
  private readonly listeners = new Map<Listener, Viewer>();
  private readonly staleAfterMs: number;
  /** What the viewer asked for; without a wish each kind of stream runs at its own default. */
  private wish?: number;
  /** The newest attached turn; older ones are ignored. */
  private active?: PreviewSource;
  /** What the active producer was last asked to do. */
  private running?: { readonly source: PreviewSource; readonly fps: number; readonly codec: PreviewCodec };
  /** Sequence number of the last chunk the producer sent. */
  private lastChunk?: number;
  private state: PreviewState = 'stopped';
  private reason?: string;
  private seq = 0;
  private latest?: { seq: number; image: PreviewImage };
  private deliveredAt = Number.NEGATIVE_INFINITY;
  private flush?: ReturnType<typeof setTimeout>;
  private quiet?: ReturnType<typeof setTimeout>;

  constructor(options: { fps?: number; staleAfterMs?: number } = {}) {
    this.wish = options.fps;
    this.staleAfterMs = options.staleAfterMs ?? 3000;
  }

  /** A viewer joins: it gets the current state and latest frame at once, then every change. */
  subscribe(listener: Listener, codecs: readonly PreviewCodec[] = ['jpeg']): () => void {
    this.listeners.set(listener, { codecs, waiting: true });
    listener(this.stateMessage());
    if (this.latest) listener({ type: 'frame', ...this.latest });
    this.sync();
    return () => {
      if (!this.listeners.delete(listener)) return;
      this.sync();
    };
  }

  /** A viewer says what it can show, after it joined. */
  accept(listener: Listener, codecs: readonly PreviewCodec[]): void {
    const viewer = this.listeners.get(listener);
    if (!viewer) return;
    viewer.codecs = codecs;
    this.sync();
  }

  /** A viewer lost its place in the video (it dropped chunks or its decoder failed). */
  keyframe(listener: Listener): void {
    const viewer = this.listeners.get(listener);
    if (!viewer || this.running?.codec !== 'h264') return;
    viewer.waiting = true;
    this.askForKey(this.running.source);
  }

  snapshot(): PreviewSnapshot {
    return { state: this.state, ...(this.reason ? { reason: this.reason } : {}), ...(this.latest ? { frame: this.latest } : {}) };
  }

  setFps(fps: number): void {
    this.wish = fps;
    this.sync();
  }

  /** A turn started using the computer. Returns the detach to call when its helper is gone. */
  attach(source: PreviewSource): () => void {
    this.active = source;
    this.forget();
    this.sync();
    return () => {
      if (this.active !== source) return;
      this.active = undefined;
      // The helper leaves with its turn, so there is nothing left to stop.
      this.running = undefined;
      this.forget();
      this.setState('stopped');
    };
  }

  /** A frame from a producer, or `undefined` for "still running, nothing changed". */
  frame(source: PreviewSource, image: PreviewImage | undefined): void {
    if (source !== this.active || this.listeners.size === 0) return;
    this.alive();
    // A producer asked for video that sends a picture cannot make video: the picture is shown.
    if (!image) return;
    this.latest = { seq: ++this.seq, image };
    const wait = this.deliveredAt + 1000 / this.rate('jpeg') - Date.now();
    if (wait <= 0) this.deliver();
    else this.flush ??= setTimeout(() => this.deliver(), wait);
  }

  /** A piece of the video from a producer. */
  chunk(source: PreviewSource, chunk: PreviewChunk): void {
    if (source !== this.active || this.running?.codec !== 'h264' || this.listeners.size === 0) return;
    this.alive();
    // A chunk went missing: what follows cannot be decoded until the stream starts again.
    const lost = !chunk.key && this.lastChunk !== undefined && chunk.seq !== this.lastChunk + 1;
    this.lastChunk = chunk.seq;
    if (lost) {
      for (const viewer of this.listeners.values()) viewer.waiting = true;
      this.askForKey(source);
    }
    for (const [listener, viewer] of this.listeners) {
      if (chunk.key) viewer.waiting = false;
      if (!viewer.waiting) listener({ type: 'chunk', ...chunk });
    }
  }

  failed(source: PreviewSource, reason: string): void {
    if (source !== this.active) return;
    clearTimeout(this.quiet);
    this.setState('unavailable', reason);
  }

  private alive(): void {
    this.setState('live');
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.setState('stale'), this.staleAfterMs);
  }

  private askForKey(source: PreviewSource): void {
    void source.keyframe().catch(() => undefined);
  }

  private codecFor(source: PreviewSource): PreviewCodec {
    const everyone = [...this.listeners.values()].every((viewer) => viewer.codecs.includes('h264'));
    return everyone && source.codecs.includes('h264') ? 'h264' : 'jpeg';
  }

  private rate(codec: PreviewCodec): number {
    const { default: usual, max } = PREVIEW_FPS[codec];
    return Math.min(max, Math.max(PREVIEW_FPS.min, Math.round(this.wish ?? usual)));
  }

  private deliver(): void {
    clearTimeout(this.flush);
    this.flush = undefined;
    if (!this.latest) return;
    this.deliveredAt = Date.now();
    this.emit({ type: 'frame', ...this.latest });
  }

  /** Makes the producer match what is wanted: running at the current rate and codec only while watched. */
  private sync(): void {
    const codec = this.active && this.codecFor(this.active);
    const wanted = this.active && codec && this.listeners.size > 0 ? { source: this.active, fps: this.rate(codec), codec } : undefined;
    const running = this.running;
    if (running && running.source !== wanted?.source) {
      this.running = undefined;
      clearTimeout(this.quiet);
      clearTimeout(this.flush);
      this.flush = undefined;
      void running.source.stop().catch(() => undefined);
    }
    if (!wanted) return;
    const same = this.running?.source === wanted.source && this.running.fps === wanted.fps && this.running.codec === wanted.codec;
    if (!same) {
      if (this.running?.codec !== wanted.codec) {
        // The other kind of stream starts from nothing: no old picture, no place in the old video.
        this.forget();
        for (const viewer of this.listeners.values()) viewer.waiting = true;
      }
      this.running = wanted;
      wanted.source.start(wanted.fps, wanted.codec).catch((error: unknown) => this.failed(wanted.source, error instanceof Error ? error.message : String(error)));
    }
    // Whoever is waiting in a video stream (a new viewer, or all of them after a switch) needs a key frame.
    if (wanted.codec === 'h264' && [...this.listeners.values()].some((viewer) => viewer.waiting) && this.lastChunk !== undefined) this.askForKey(wanted.source);
  }

  private forget(): void {
    clearTimeout(this.quiet);
    clearTimeout(this.flush);
    this.flush = undefined;
    this.latest = undefined;
    this.lastChunk = undefined;
    this.deliveredAt = Number.NEGATIVE_INFINITY;
  }

  private setState(state: PreviewState, reason?: string): void {
    if (this.state === state && this.reason === reason) return;
    this.state = state;
    this.reason = reason;
    this.emit(this.stateMessage());
  }

  private stateMessage(): PreviewMessage {
    return { type: 'state', state: this.state, ...(this.reason ? { reason: this.reason } : {}) };
  }

  private emit(message: PreviewMessage): void {
    for (const listener of this.listeners.keys()) listener(message);
  }
}
