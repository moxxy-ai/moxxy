import type { Point } from './input.js';

/**
 * The agent's own pointer over the Browser pane.
 *
 * The pane draws it; this decides where it goes and when an action may follow.
 * A press waits until the pointer has arrived, so what the person sees is the
 * pointer reaching the element and then the page answering — never the page
 * changing under a pointer still on its way.
 */

export type CursorPhase = 'moving' | 'delivered' | 'failed';

export interface CursorFrame {
  readonly requestId: string;
  readonly tabId: string;
  /** `null` takes the pointer off the page. */
  readonly cursor: { x: number; y: number; phase: CursorPhase; durationMs: number } | null;
}

export type CursorSink = (frame: CursorFrame) => void;

/** The same pacing as the Computer Use cursor (`CursorMotion.duration`). */
const MIN_GLIDE_MS = 100;
const MAX_GLIDE_MS = 250;
const MS_PER_PIXEL = 0.3;
/** How long past its glide a pane that never answers is waited for. */
const ARRIVAL_SLACK_MS = 500;

/** How long the pointer takes from `from` to `to`; it appears in place when it was nowhere. */
export function glideMs(from: Point | undefined, to: Point): number {
  if (!from) return 0;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.round(Math.min(Math.max(MIN_GLIDE_MS, MIN_GLIDE_MS + distance * MS_PER_PIXEL), MAX_GLIDE_MS));
}

export class AgentPointer {
  private sink: CursorSink | null = null;
  private readonly at = new Map<string, Point>();
  private readonly arrivals = new Map<string, () => void>();
  private seq = 0;

  setSink(sink: CursorSink | null): void {
    this.sink = sink;
  }

  /** Glide to `to`; resolves once the pane reports the pointer there, or at a deadline. */
  moveTo(tabId: string, to: Point): Promise<void> {
    const durationMs = glideMs(this.at.get(tabId), to);
    this.at.set(tabId, to);
    const sink = this.sink;
    if (!sink) return Promise.resolve();
    const requestId = this.nextId();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.arrivals.delete(requestId);
        resolve();
      };
      // A pane that is closed or busy must not park the agent: go ahead regardless.
      const timer = setTimeout(done, durationMs + ARRIVAL_SLACK_MS);
      timer.unref?.();
      this.arrivals.set(requestId, done);
      sink({ requestId, tabId, cursor: { ...to, phase: 'moving', durationMs } });
    });
  }

  /** The pane reporting that the pointer reached the place it was sent to. */
  arrived(requestId: string): void {
    this.arrivals.get(requestId)?.();
  }

  /** Mark the press where the pointer stands: delivered, or failed. */
  finish(tabId: string, delivered: boolean): void {
    const point = this.at.get(tabId);
    if (!point) return;
    this.sink?.({
      requestId: this.nextId(),
      tabId,
      cursor: { ...point, phase: delivered ? 'delivered' : 'failed', durationMs: 0 },
    });
  }

  /** Take the pointer off every page; it appears in place the next time it is needed. */
  hideAll(): void {
    for (const tabId of this.at.keys()) this.forget(tabId);
  }

  /** Take the pointer off one page. */
  forget(tabId: string): void {
    if (!this.at.delete(tabId)) return;
    this.sink?.({ requestId: this.nextId(), tabId, cursor: null });
  }

  private nextId(): string {
    return `cur${++this.seq}`;
  }
}
