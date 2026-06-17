/**
 * A Surface is a long-lived, interactive pane that BOTH a human viewer (a
 * desktop panel) and the agent drive together: an embedded terminal (a shared
 * PTY) or an in-window browser (a shared page). Unlike a {@link Channel} — which
 * is a whole conversation transport — a Surface is a single resource attached to
 * an existing Session, streaming opaque output frames out and accepting opaque
 * input messages in.
 *
 * Surfaces are RUNNER-OWNED: the underlying resource (PTY, Playwright page) lives
 * in the same process as the agent's tools, so the agent reads/writes the exact
 * same instance the user watches. A thin client (the desktop) renders the
 * streamed frames and relays the user's input back over the runner protocol —
 * there is no reverse RPC. Plugins contribute surfaces via
 * `definePlugin({ surfaces: [defineSurface(...)] })`; the plugin's own tools
 * (e.g. `terminal`, `browser_session`) share the resource through module state.
 *
 * The payloads (`SurfaceDataMessage.payload`, `SurfaceInputMessage`) are
 * deliberately opaque (`unknown` / open record): they cross the JSON-RPC wire
 * verbatim and each surface kind defines its own shape (PTY bytes, a base64
 * frame, a navigate request). Keeping them untyped here means a new surface kind
 * never has to touch this file or the protocol.
 */

/**
 * Surface kind discriminator. Open string union so plugins add kinds without
 * editing the SDK; the built-ins are `'terminal'` and `'browser'`.
 */
export type SurfaceKind = 'terminal' | 'browser' | (string & {});

/** One outbound frame from a surface instance to its viewers. */
export interface SurfaceDataMessage {
  /** The instance this frame belongs to (a viewer may watch several). */
  readonly surfaceId: string;
  readonly kind: SurfaceKind;
  /** Surface-specific payload (PTY text, a base64 frame, a url/title update). */
  readonly payload: unknown;
}

/**
 * One inbound message from a viewer to a surface instance — a keystroke, a
 * mouse event, a navigate request, a resize. `type` discriminates; the rest is
 * surface-specific.
 */
export interface SurfaceInputMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** Viewport hint for a resize (terminal cols/rows or pixel width/height). */
export interface SurfaceSize {
  readonly cols?: number;
  readonly rows?: number;
  readonly width?: number;
  readonly height?: number;
}

/**
 * A live, attached surface instance — the running PTY or browser page. Opening
 * the same kind twice returns the SAME instance (surfaces are shared), so a
 * viewer that joins late gets the existing resource plus its {@link snapshot}.
 */
export interface SurfaceInstance {
  readonly id: string;
  readonly kind: SurfaceKind;
  /** Subscribe to outbound frames. Returns an unsubscribe fn. */
  onData(cb: (payload: unknown) => void): () => void;
  /**
   * A catch-up payload for a late-joining viewer (terminal scrollback, the last
   * browser frame, the current url). Optional — a surface with no replayable
   * state omits it.
   */
  snapshot?(): unknown;
  /** Apply an inbound message from a viewer (or the agent's tool). */
  input(msg: SurfaceInputMessage): void | Promise<void>;
  /** Re-size the viewport, when the surface is size-aware. */
  resize?(size: SurfaceSize): void | Promise<void>;
  /**
   * Detach this instance. The underlying shared resource MAY persist (the
   * agent's tool can still use the PTY/page); `close` just tears down streaming
   * + viewer state. A surface that owns its resource exclusively disposes it.
   */
  close(): void | Promise<void>;
}

/** Whether a surface kind can run right now (e.g. node-pty present). */
export interface SurfaceAvailability {
  readonly ok: boolean;
  /** Human-readable explanation when `ok` is false (shown in the empty pane). */
  readonly reason?: string;
}

/** Context handed to a surface when it opens. */
export interface SurfaceContext {
  /** Working directory of the owning Session. */
  readonly cwd: string;
  readonly logger?: {
    debug?(msg: string, meta?: Record<string, unknown>): void;
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * A registered, named factory for a Surface. `open` is idempotent per kind: a
 * second `open` attaches to the resource the first one created (the host
 * enforces this), so the agent's tool and the user's pane share one instance.
 */
export interface SurfaceDef {
  readonly kind: SurfaceKind;
  readonly description?: string;
  open(ctx: SurfaceContext): Promise<SurfaceInstance> | SurfaceInstance;
  /** Optional runtime gate (default: always available). */
  isAvailable?(ctx: SurfaceContext): Promise<SurfaceAvailability> | SurfaceAvailability;
}

/** Identity helper mirroring `defineTool` / `defineChannel`. */
export function defineSurface(def: SurfaceDef): SurfaceDef {
  return def;
}

/**
 * Read-only registry of surface defs contributed by plugins. Implementation
 * lives in @moxxy/core.
 */
export interface SurfaceRegistry {
  list(): ReadonlyArray<SurfaceDef>;
  get(kind: SurfaceKind): SurfaceDef | undefined;
  has(kind: SurfaceKind): boolean;
}

/** Wire-friendly surface descriptor for `surface.list` (no functions). */
export interface SurfaceInfo {
  readonly kind: SurfaceKind;
  readonly description?: string;
  readonly available: boolean;
  /** Why it is unavailable, when `available` is false. */
  readonly reason?: string;
}

/** Result of opening a surface — its id + a catch-up snapshot for the viewer. */
export interface OpenSurfaceResult {
  readonly surfaceId: string;
  readonly kind: SurfaceKind;
  readonly snapshot?: unknown;
}

/**
 * The runtime manager of open surface instances, present on an in-process
 * `Session`. The runner server drives it on behalf of attached clients; the
 * agent's tools reach the SAME underlying resources through plugin module state.
 * Output from every open instance is multiplexed through {@link onData}.
 */
export interface SurfaceHost {
  /** Available surface kinds with their current availability. */
  list(): Promise<ReadonlyArray<SurfaceInfo>>;
  /** Open (or attach to the shared) instance for a kind. */
  open(kind: SurfaceKind): Promise<OpenSurfaceResult>;
  /** Route a viewer message to an open instance. No-op if it isn't open. */
  input(surfaceId: string, msg: SurfaceInputMessage): Promise<void>;
  /** Resize an open instance. No-op if it isn't open or isn't size-aware. */
  resize(surfaceId: string, size: SurfaceSize): Promise<void>;
  /** Close one open instance. */
  close(surfaceId: string): Promise<void>;
  /**
   * Subscribe to outbound frames from EVERY open instance (multiplexed by
   * `surfaceId`). Returns an unsubscribe fn. The runner subscribes once and
   * broadcasts each frame as a `surface.data` notification.
   */
  onData(cb: (msg: SurfaceDataMessage) => void): () => void;
  /** Close every open instance (session teardown). */
  closeAll(): Promise<void>;
}
