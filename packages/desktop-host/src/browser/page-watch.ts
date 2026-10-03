import type { Cdp } from './input.js';

/**
 * What a page is doing between the agent's commands: dialogs it opened, and
 * navigations it started and finished.
 *
 * Fed by CDP events rather than asked on a timer, so a press that opens an
 * `alert()` is noticed while the press is still in flight — which matters,
 * because a page showing a dialog runs no script and the press itself does not
 * return until someone answers. Unwatched, that took the whole tab down: the
 * debugger reported "target closed" and every later command failed with it.
 */

export type DialogType = 'alert' | 'confirm' | 'prompt' | 'beforeunload';

export interface Dialog {
  readonly type: DialogType;
  readonly message: string;
  readonly defaultPrompt?: string;
}

export interface Mark {
  readonly navigations: number;
  readonly loads: number;
}

type MessageListener = (event: unknown, method: string, params: unknown, sessionId?: string) => void;

/** Where CDP events arrive: Electron's `webContents.debugger`, or a stand-in with the same shape. */
export interface DebuggerEvents {
  on?(event: 'message', listener: MessageListener): void;
  removeListener?(event: 'message', listener: MessageListener): void;
}

/** A frame from another site, attached as its own debugging session. */
export interface FrameSession {
  readonly sessionId: string;
  readonly targetId: string;
  readonly url: string;
}

const DIALOG_TYPES = new Set<string>(['alert', 'confirm', 'prompt', 'beforeunload']);

export class PageWatch {
  private dialog: Dialog | null = null;
  private navigations = 0;
  private loads = 0;
  private mainFrame: string | null = null;
  private readonly dialogWaiters = new Set<(dialog: Dialog) => void>();
  private readonly loadWaiters = new Set<() => void>();
  private listener: MessageListener | null = null;
  private readonly frameSessions = new Map<string, FrameSession>();
  private readonly attachWaiters = new Set<() => void>();

  constructor(private readonly events: DebuggerEvents) {}

  /** Start listening. Idempotent; a view with no event channel is simply not watched. */
  async start(cdp: Cdp): Promise<void> {
    if (this.listener || !this.events.on) return;
    this.listener = (_event, method, params, sessionId) => {
      // Events from a frame's own session describe that frame, not the page.
      if (!sessionId) this.onMessage(method, params);
    };
    this.events.on('message', this.listener);
    try {
      await cdp.send('Page.enable');
      const tree = (await cdp.send('Page.getFrameTree')) as { frameTree?: { frame?: { id?: string } } };
      this.mainFrame = tree?.frameTree?.frame?.id ?? null;
    } catch {
      // A page that will not enable is still drivable; it is just not watched.
    }
    try {
      // Frames from other sites live in other processes; each one attaches as a
      // session of its own, announced by `Target.attachedToTarget`.
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    } catch {
      // Without it the page is still read, just not inside such frames.
    }
  }

  stop(): void {
    if (this.listener) this.events.removeListener?.('message', this.listener);
    this.listener = null;
    this.dialog = null;
    this.frameSessions.clear();
  }

  /**
   * Wait until at least `count` frame sessions have attached, or the deadline.
   * Woken by the attachments themselves; at the deadline it simply returns —
   * the page may hold frames from its own site, which attach as nothing.
   */
  waitForFrames(count: number, timeoutMs: number): Promise<void> {
    if (this.frameSessions.size >= count) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.attachWaiters.delete(check);
        resolve();
      };
      const check = (): void => {
        if (this.frameSessions.size >= count) done();
      };
      const timer = setTimeout(done, Math.max(0, timeoutMs));
      timer.unref?.();
      this.attachWaiters.add(check);
    });
  }

  /** Frames from other sites the page holds right now, each with its own session. */
  get frames(): ReadonlyArray<FrameSession> {
    return [...this.frameSessions.values()];
  }

  get watching(): boolean {
    return this.listener !== null;
  }

  /** The dialog the page is showing right now, if any. */
  get openDialog(): Dialog | null {
    return this.dialog;
  }

  mark(): Mark {
    return { navigations: this.navigations, loads: this.loads };
  }

  /** Whether the main frame started loading a new document since the mark. */
  navigatedSince(mark: Mark): boolean {
    return this.navigations > mark.navigations;
  }

  /**
   * The next dialog the page opens. `cancel` releases the wait, so a press that
   * opened nothing does not leave a waiter behind.
   */
  nextDialog(): { promise: Promise<Dialog>; cancel: () => void } {
    let waiter: ((dialog: Dialog) => void) | null = null;
    const promise = new Promise<Dialog>((resolve) => {
      waiter = resolve;
      this.dialogWaiters.add(resolve);
    });
    return {
      promise,
      cancel: () => {
        if (waiter) this.dialogWaiters.delete(waiter);
      },
    };
  }

  /**
   * Resolve true once a page load completes after the mark, false at the
   * deadline — which means "still loading", never "loaded".
   */
  waitLoad(mark: Mark, timeoutMs: number): Promise<boolean> {
    if (this.loads > mark.loads) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const done = (loaded: boolean): void => {
        clearTimeout(timer);
        this.loadWaiters.delete(check);
        resolve(loaded);
      };
      const check = (): void => {
        if (this.loads > mark.loads) done(true);
      };
      const timer = setTimeout(() => done(false), Math.max(0, timeoutMs));
      timer.unref?.();
      this.loadWaiters.add(check);
    });
  }

  private onMessage(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'Page.javascriptDialogOpening': {
        const type = String(p.type ?? '');
        if (!DIALOG_TYPES.has(type)) return;
        const dialog: Dialog = {
          type: type as DialogType,
          message: String(p.message ?? ''),
          ...(typeof p.defaultPrompt === 'string' && p.defaultPrompt ? { defaultPrompt: p.defaultPrompt } : {}),
        };
        this.dialog = dialog;
        for (const waiter of [...this.dialogWaiters]) waiter(dialog);
        this.dialogWaiters.clear();
        return;
      }
      case 'Page.javascriptDialogClosed':
        this.dialog = null;
        return;
      case 'Page.frameStartedLoading':
        if (this.isMain(p.frameId)) this.navigations++;
        return;
      case 'Page.frameNavigated': {
        const frame = (p.frame ?? {}) as { id?: string; parentId?: string };
        if (frame.parentId === undefined && typeof frame.id === 'string') this.mainFrame = frame.id;
        return;
      }
      case 'Target.attachedToTarget': {
        const info = (p.targetInfo ?? {}) as { targetId?: string; type?: string; url?: string };
        if (info.type === 'iframe' && typeof p.sessionId === 'string' && typeof info.targetId === 'string') {
          this.frameSessions.set(p.sessionId, { sessionId: p.sessionId, targetId: info.targetId, url: info.url ?? '' });
          for (const check of [...this.attachWaiters]) check();
        }
        return;
      }
      case 'Target.detachedFromTarget':
        if (typeof p.sessionId === 'string') this.frameSessions.delete(p.sessionId);
        return;
      case 'Page.loadEventFired':
        this.loads++;
        for (const check of [...this.loadWaiters]) check();
        return;
      default:
        return;
    }
  }

  private isMain(frameId: unknown): boolean {
    return this.mainFrame === null || frameId === this.mainFrame;
  }
}

/**
 * Wait until the page stops changing: no DOM mutation for `quietMs`, or
 * `maxMs` at most.
 *
 * What a click sets off — a menu opening, a list filtering, a request whose
 * answer redraws half the page — finishes at no fixed time, and reading the
 * page too early hands the model a half-drawn state. The observer runs inside
 * the page and resolves from the mutations themselves.
 *
 * A navigation tears this context down mid-wait; that is reported by the page
 * watch, not here, so an error from this evaluation is not a failure.
 */
export async function waitQuiet(cdp: Cdp, quietMs: number, maxMs: number): Promise<void> {
  try {
    await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise((resolve) => {
        let quiet;
        const done = () => { observer.disconnect(); clearTimeout(quiet); clearTimeout(cap); resolve(true); };
        const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, ${quietMs}); });
        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        quiet = setTimeout(done, ${quietMs});
        const cap = setTimeout(done, ${maxMs});
      })`,
    });
  } catch {
    // The document went away (a navigation) or the page would not run it.
  }
}
