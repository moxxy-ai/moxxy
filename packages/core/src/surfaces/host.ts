import type {
  OpenSurfaceResult,
  SurfaceContext,
  SurfaceDataMessage,
  SurfaceHost,
  SurfaceInfo,
  SurfaceInputMessage,
  SurfaceInstance,
  SurfaceKind,
  SurfaceSize,
} from '@moxxy/sdk';
import type { Logger } from '../logger.js';
import type { SurfaceRegistryImpl } from '../registries/surfaces.js';

/**
 * Manages the live, open {@link SurfaceInstance}s for a Session and multiplexes
 * every instance's output through a single {@link onData} fan-out. The runner
 * subscribes once and rebroadcasts each frame as a `surface.data` notification;
 * the agent's tools reach the SAME underlying resource (PTY, page) through their
 * plugin's module state, so a `terminal`/`browser_session` tool call appears in
 * the very pane the user is watching.
 *
 * Opening a kind is idempotent: a second `open` returns the instance the first
 * created (surfaces are shared), so a late-joining viewer attaches to the
 * existing resource and gets its {@link SurfaceInstance.snapshot}.
 */
export class SurfaceHostImpl implements SurfaceHost {
  /** Open instances, keyed by kind (one shared instance per kind). */
  private readonly instances = new Map<SurfaceKind, SurfaceInstance>();
  /** Per-instance unsubscribe from its onData, dropped on close. */
  private readonly unsubs = new Map<string, () => void>();
  private readonly dataListeners = new Set<(msg: SurfaceDataMessage) => void>();
  /** In-flight opens, so concurrent `open(kind)` calls share one instance. */
  private readonly opening = new Map<SurfaceKind, Promise<OpenSurfaceResult>>();
  /**
   * Viewer attach count per kind. A surface is SHARED (the agent's tool + every
   * attached viewer drive the same PTY/page), so `open` retains and `close`
   * releases; the instance is only torn down when the last viewer detaches.
   * Without this, a single viewer's `close` would destroy the resource out from
   * under the others — and React StrictMode (dev) makes that routine: it
   * mounts → unmounts → remounts, so the first mount's late-resolving `open`
   * closes the very instance the remount just attached to, leaving `input`/
   * `resize` to hit a now-missing instance (output still flows from the
   * snapshot, but keystrokes/navigation silently vanish).
   */
  private readonly refs = new Map<SurfaceKind, number>();

  constructor(
    private readonly registry: SurfaceRegistryImpl,
    private readonly ctx: SurfaceContext,
    private readonly logger?: Logger,
  ) {}

  async list(): Promise<ReadonlyArray<SurfaceInfo>> {
    const out: SurfaceInfo[] = [];
    for (const def of this.registry.list()) {
      let available = true;
      let reason: string | undefined;
      if (def.isAvailable) {
        try {
          const a = await def.isAvailable(this.ctx);
          available = a.ok;
          reason = a.reason;
        } catch (err) {
          available = false;
          reason = err instanceof Error ? err.message : String(err);
        }
      }
      out.push({
        kind: def.kind,
        ...(def.description ? { description: def.description } : {}),
        available,
        ...(reason ? { reason } : {}),
      });
    }
    return out;
  }

  async open(kind: SurfaceKind): Promise<OpenSurfaceResult> {
    const existing = this.instances.get(kind);
    if (existing) {
      this.retain(kind);
      return this.describe(existing);
    }
    const pending = this.opening.get(kind);
    if (pending) {
      // Ride the in-flight create, but still count this viewer's attach.
      const res = await pending;
      this.retain(kind);
      return res;
    }

    const def = this.registry.get(kind);
    if (!def) throw new Error(`No surface registered for kind: ${kind}`);

    const promise = (async (): Promise<OpenSurfaceResult> => {
      const instance = await def.open(this.ctx);
      this.instances.set(kind, instance);
      this.refs.set(kind, 1);
      // Re-emit this instance's frames as multiplexed SurfaceDataMessages.
      const unsub = instance.onData((payload) =>
        this.emit({ surfaceId: instance.id, kind: instance.kind, payload }),
      );
      this.unsubs.set(instance.id, unsub);
      return this.describe(instance);
    })();
    this.opening.set(kind, promise);
    try {
      return await promise;
    } finally {
      this.opening.delete(kind);
    }
  }

  async input(surfaceId: string, msg: SurfaceInputMessage): Promise<void> {
    const instance = this.byId(surfaceId);
    if (!instance) return;
    await instance.input(msg);
  }

  async resize(surfaceId: string, size: SurfaceSize): Promise<void> {
    const instance = this.byId(surfaceId);
    if (!instance?.resize) return;
    await instance.resize(size);
  }

  async close(surfaceId: string): Promise<void> {
    const instance = this.byId(surfaceId);
    if (!instance) return;
    const kind = instance.kind;
    // Release this viewer; keep the shared instance alive while others hold it.
    const remaining = (this.refs.get(kind) ?? 1) - 1;
    if (remaining > 0) {
      this.refs.set(kind, remaining);
      return;
    }
    this.refs.delete(kind);
    this.unsubs.get(surfaceId)?.();
    this.unsubs.delete(surfaceId);
    this.instances.delete(kind);
    try {
      await instance.close();
    } catch (err) {
      this.logger?.warn?.('SurfaceHost: close failed', {
        surfaceId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Bump the viewer attach count for an already-open kind. */
  private retain(kind: SurfaceKind): void {
    this.refs.set(kind, (this.refs.get(kind) ?? 0) + 1);
  }

  private describe(instance: SurfaceInstance): OpenSurfaceResult {
    return {
      surfaceId: instance.id,
      kind: instance.kind,
      ...(instance.snapshot ? { snapshot: instance.snapshot() } : {}),
    };
  }

  onData(cb: (msg: SurfaceDataMessage) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  async closeAll(): Promise<void> {
    // Session shutdown: tear every instance down regardless of viewer refs.
    for (const kind of [...this.instances.keys()]) this.refs.set(kind, 1);
    const ids = [...this.unsubs.keys()];
    for (const id of ids) await this.close(id);
  }

  private byId(surfaceId: string): SurfaceInstance | undefined {
    for (const instance of this.instances.values()) {
      if (instance.id === surfaceId) return instance;
    }
    return undefined;
  }

  private emit(msg: SurfaceDataMessage): void {
    for (const fn of this.dataListeners) {
      try {
        fn(msg);
      } catch {
        /* a bad listener must not break the stream */
      }
    }
  }
}
