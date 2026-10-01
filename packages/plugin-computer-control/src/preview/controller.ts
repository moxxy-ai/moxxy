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

export type PreviewMessage =
  | { readonly type: 'frame'; readonly seq: number; readonly image: PreviewImage }
  | { readonly type: 'state'; readonly state: PreviewState; readonly reason?: string };

export interface PreviewSnapshot {
  readonly state: PreviewState;
  readonly reason?: string;
  readonly frame?: { readonly seq: number; readonly image: PreviewImage };
}

/** One turn's helper, as far as the preview is concerned. `start` on a running producer changes its rate. */
export interface PreviewSource {
  start(fps: number): Promise<void>;
  stop(): Promise<void>;
}

export const PREVIEW_FPS = { default: 2, min: 1, max: 5 } as const;
const clampFps = (fps: number) => Math.min(PREVIEW_FPS.max, Math.max(PREVIEW_FPS.min, Math.round(fps)));

type Listener = (message: PreviewMessage) => void;

/**
 * Connects the viewers of the preview to the helper of the turn that is using
 * the computer. The helper captures only while someone watches; viewers get the
 * latest frame at the chosen rate, never a backlog.
 */
export class PreviewController {
  private readonly listeners = new Set<Listener>();
  private readonly staleAfterMs: number;
  private fps: number;
  /** The newest attached turn; older ones are ignored. */
  private active?: PreviewSource;
  /** What the active producer was last asked to do. */
  private running?: { readonly source: PreviewSource; readonly fps: number };
  private state: PreviewState = 'stopped';
  private reason?: string;
  private seq = 0;
  private latest?: { seq: number; image: PreviewImage };
  private deliveredAt = Number.NEGATIVE_INFINITY;
  private flush?: ReturnType<typeof setTimeout>;
  private quiet?: ReturnType<typeof setTimeout>;

  constructor(options: { fps?: number; staleAfterMs?: number } = {}) {
    this.fps = clampFps(options.fps ?? PREVIEW_FPS.default);
    this.staleAfterMs = options.staleAfterMs ?? 3000;
  }

  /** A viewer joins: it gets the current state and latest frame at once, then every change. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.stateMessage());
    if (this.latest) listener({ type: 'frame', ...this.latest });
    this.sync();
    return () => {
      if (!this.listeners.delete(listener)) return;
      this.sync();
    };
  }

  snapshot(): PreviewSnapshot {
    return { state: this.state, ...(this.reason ? { reason: this.reason } : {}), ...(this.latest ? { frame: this.latest } : {}) };
  }

  setFps(fps: number): void {
    this.fps = clampFps(fps);
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
    this.setState('live');
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.setState('stale'), this.staleAfterMs);
    if (!image) return;
    this.latest = { seq: ++this.seq, image };
    const wait = this.deliveredAt + 1000 / this.fps - Date.now();
    if (wait <= 0) this.deliver();
    else this.flush ??= setTimeout(() => this.deliver(), wait);
  }

  failed(source: PreviewSource, reason: string): void {
    if (source !== this.active) return;
    clearTimeout(this.quiet);
    this.setState('unavailable', reason);
  }

  private deliver(): void {
    clearTimeout(this.flush);
    this.flush = undefined;
    if (!this.latest) return;
    this.deliveredAt = Date.now();
    this.emit({ type: 'frame', ...this.latest });
  }

  /** Makes the producer match what is wanted: running at the current rate only while watched. */
  private sync(): void {
    const wanted = this.active && this.listeners.size > 0 ? { source: this.active, fps: this.fps } : undefined;
    const running = this.running;
    if (running && running.source !== wanted?.source) {
      this.running = undefined;
      clearTimeout(this.quiet);
      clearTimeout(this.flush);
      this.flush = undefined;
      void running.source.stop().catch(() => undefined);
    }
    if (!wanted || (this.running?.source === wanted.source && this.running.fps === wanted.fps)) return;
    this.running = wanted;
    wanted.source.start(wanted.fps).catch((error: unknown) => this.failed(wanted.source, error instanceof Error ? error.message : String(error)));
  }

  private forget(): void {
    clearTimeout(this.quiet);
    clearTimeout(this.flush);
    this.flush = undefined;
    this.latest = undefined;
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
    for (const listener of this.listeners) listener(message);
  }
}
