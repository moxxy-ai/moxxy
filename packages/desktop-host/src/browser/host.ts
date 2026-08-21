import { createHash } from 'node:crypto';
import {
  buildAxTree,
  formatAxTree,
  formatSnapshot,
  redactSecretValues,
  type AxNode,
  type TabInfo,
} from '@moxxy/plugin-browser';

/**
 * The agent's browser, living in the desktop's main process.
 *
 * The page is a real Chromium view the window composites — a `<webview>` the
 * renderer attaches and main immediately takes ownership of. There is no
 * screenshot pipeline: the human sees the page because Chromium draws it, the
 * same way it draws the rest of the app. Frames are not encoded, not
 * base64'd, not sent anywhere.
 *
 * The agent sees the same page through CDP (`webContents.debugger`), reading
 * the accessibility tree rather than pixels. Both halves address one document,
 * which is the property that makes "watch the agent work, then take over"
 * possible at all — two separate browsers could never offer it.
 *
 * Reuses the accessibility layer from `@moxxy/plugin-browser`: that code is
 * pure and takes a minimal CDP interface, so it does not care whether the
 * channel underneath is Playwright's or Electron's.
 */

/** One persistent profile shared by every tab, so a login survives. */
export const BROWSER_PARTITION = 'persist:moxxy-browser';

/** The slice of Electron's `WebContents` this host needs. */
export interface HostWebContents {
  readonly id: number;
  getURL(): string;
  getTitle(): string;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  reload(): void;
  readonly navigationHistory: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
  };
  readonly debugger: {
    isAttached(): boolean;
    attach(version: string): void;
    detach(): void;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
  sendInputEvent(event: Record<string, unknown>): void;
  /** Optional so a minimal stand-in still satisfies the type; Electron has both. */
  on?(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
  /** Give this view keyboard focus. Optional for the same reason. */
  focus?(): void;
}

/** Resolve a live `WebContents` by id; null once it is gone. */
export type WebContentsLookup = (id: number) => HostWebContents | null;

interface Tab {
  readonly id: string;
  readonly webContentsId: number;
  /** uid → node from the last snapshot, plus the URL it was taken at. */
  snapshot?: { index: ReadonlyMap<string, AxNode>; url: string };
  /** Detach the page-change listeners this host put on the view. */
  unwatch?: () => void;
  /** Fingerprint of the page the last snapshot described. */
  seen?: string;
  /** Countdown to releasing this tab's accessibility tree. */
  idle?: ReturnType<typeof setTimeout>;
}

/**
 * Page events that change what a tab strip should say about a tab.
 *
 * `list()` reads the title and URL live, so anything that asks gets the truth —
 * but the pane is pushed to, not polling. Without these the strip kept whatever
 * was true at registration: a page that retitled or navigated itself left the
 * strip naming something that was no longer on screen.
 */
const PAGE_CHANGE_EVENTS = ['page-title-updated', 'did-navigate', 'did-navigate-in-page'] as const;

/**
 * How long a tab may go untouched before its accessibility tree is handed back.
 *
 * Chromium builds no such tree until something asks for one, and then maintains
 * it across every DOM mutation. Measured on a Wikipedia article: 49 MB, held for
 * as long as the tab lived, because the only thing that ever detached was
 * closing it. Thirty seconds is long enough that a thinking agent does not keep
 * paying to re-enable, short enough that a tab left open stops costing.
 */
const IDLE_RELEASE_MS = 30_000;

/** CDP's modifier bitmask, named so the mask test below reads as one. */
const MOD_ALT = 1;
const MOD_CONTROL = 2;
const MOD_META = 4;
const MOD_SHIFT = 8;

const MODIFIERS: Record<string, number> = {
  alt: MOD_ALT,
  option: MOD_ALT,
  control: MOD_CONTROL,
  ctrl: MOD_CONTROL,
  meta: MOD_META,
  cmd: MOD_META,
  command: MOD_META,
  shift: MOD_SHIFT,
};

/**
 * Editing commands a modified letter is expected to perform.
 *
 * Chromium routes these below the key event, so dispatching the modified letter
 * alone selects nothing — which is precisely the failure that sent the agent
 * looking for another browser. Control and Meta map to the same command so a
 * task written on one platform still works on the other.
 */
const EDITING: Record<string, string> = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' };

/** Named keys, with the virtual-key code Chromium wants for each. */
const NAMED: Record<string, { key: string; code: string; code_: number }> = {
  enter: { key: 'Enter', code: 'Enter', code_: 13 },
  tab: { key: 'Tab', code: 'Tab', code_: 9 },
  escape: { key: 'Escape', code: 'Escape', code_: 27 },
  esc: { key: 'Escape', code: 'Escape', code_: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', code_: 8 },
  delete: { key: 'Delete', code: 'Delete', code_: 46 },
  space: { key: ' ', code: 'Space', code_: 32 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', code_: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', code_: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', code_: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', code_: 39 },
  home: { key: 'Home', code: 'Home', code_: 36 },
  end: { key: 'End', code: 'End', code_: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', code_: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', code_: 34 },
};

/** How Chromium wants one key spelled, or null if we cannot spell it. */
function spellKey(name: string): { key: string; code: string; code_: number } | null {
  const named = NAMED[name.toLowerCase()];
  if (named) return named;
  if ([...name].length !== 1) return null;
  const upper = name.toUpperCase();
  const isLetter = upper >= 'A' && upper <= 'Z';
  const isDigit = name >= '0' && name <= '9';
  if (!isLetter && !isDigit) return null;
  return {
    key: name,
    code: isLetter ? `Key${upper}` : `Digit${name}`,
    code_: upper.charCodeAt(0),
  };
}

export interface HostReply {
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}

const ok = (result?: unknown): HostReply => ({ ok: true, ...(result !== undefined ? { result } : {}) });
const fail = (message: string): HostReply => ({ ok: false, error: { message } });

export class BrowserHost {
  private readonly tabs = new Map<string, Tab>();
  private active: string | null = null;
  /**
   * The tab the agent is working on, which is NOT the tab the pane has in
   * front. Conflating the two means a person clicking a tab mid-task silently
   * re-aims the agent's next un-targeted command at the page they just opened.
   */
  private agentTab: string | null = null;
  private counter = 0;
  /** Renderer channel for "give this view keyboard focus", and who is waiting. */
  private askFocus: ((req: { requestId: string; tabId: string }) => void) | null = null;
  private readonly pendingFocus = new Map<string, () => void>();
  private focusSeq = 0;
  /** Fires whenever the tab set or the active tab changes. */
  private readonly listeners = new Set<() => void>();
  /**
   * Tabs the agent asked for that the renderer has not created yet.
   *
   * Main cannot make a `<webview>` — the element belongs to the renderer's
   * DOM. So `newTab` asks, and the promise settles when the renderer comes
   * back through `register` carrying the same request id. A request that is
   * never answered rejects rather than hanging the agent's turn.
   */
  private readonly pendingOpens = new Map<string, {
    resolve: (tabId: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private openSeq = 0;
  /** Installed by the IPC layer; forwards an open request to the renderer. */
  private askRenderer: ((req: { requestId: string; url: string }) => void) | null = null;
  /**
   * Hand-offs waiting on the person at the keyboard.
   *
   * The agent hits a login wall it must not get past on its own; this is how it
   * stops and asks. While one is outstanding the agent is NOT looking at the
   * page — that is the point, and it is why the request carries no snapshot.
   */
  private readonly pendingHandoffs = new Map<string, {
    resolve: (done: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private handoffSeq = 0;
  private askHuman: ((req: { requestId: string; tabId: string; reason: string }) => void) | null = null;

  constructor(
    private readonly lookup: WebContentsLookup,
    /** Overridable so a test does not have to wait half a minute. */
    private readonly idleReleaseMs: number = IDLE_RELEASE_MS,
  ) {}

  /**
   * Wire the channel main uses to ask the renderer to focus a view.
   *
   * A key only reaches the page when the `<webview>` ELEMENT has focus in the
   * window's DOM, and answering an approval prompt takes that away — answering
   * means clicking in the app. `webContents.focus()` from here does not fix it:
   * the guest is a child of the embedder, and only the renderer can focus the
   * element. Without a pane to ask, keys are sent anyway; a key that silently
   * never fires is worse than one aimed at a view that may already be focused.
   */
  setFocuser(fn: ((req: { requestId: string; tabId: string }) => void) | null): void {
    this.askFocus = fn;
  }

  /** The renderer reporting that the view now has focus. */
  confirmFocus(requestId: string): void {
    const waiting = this.pendingFocus.get(requestId);
    if (waiting) waiting();
  }

  private focusView(tab: Tab, timeoutMs: number): Promise<void> {
    const ask = this.askFocus;
    if (!ask) {
      this.lookup(tab.webContentsId)?.focus?.();
      return Promise.resolve();
    }
    const requestId = `focus${++this.focusSeq}`;
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.pendingFocus.delete(requestId);
        resolve();
      };
      // A renderer that never answers must not park the turn: press regardless.
      const timer = setTimeout(done, timeoutMs);
      timer.unref?.();
      this.pendingFocus.set(requestId, done);
      ask({ requestId, tabId: tab.id });
    });
  }

  /** Wire the channel main uses to ask the renderer for a new view. */
  setOpener(fn: ((req: { requestId: string; url: string }) => void) | null): void {
    this.askRenderer = fn;
  }

  /** Wire the channel main uses to put a hand-off request in front of the user. */
  setHandoffPrompt(fn: ((req: { requestId: string; tabId: string; reason: string }) => void) | null): void {
    this.askHuman = fn;
  }

  /**
   * Stop and wait for the person at the keyboard.
   *
   * Used when the page needs something the agent must not do itself — signing
   * in, a one-time code, accepting terms. The agent's own observation stops
   * here by construction: this call does not return a snapshot, and the tool
   * that wraps it takes a fresh one only AFTER the user says they are done. So
   * nothing typed during the hand-off is read, logged, or sent to the model.
   *
   * Resolves `true` when the user finishes, `false` when they skip. Rejects if
   * nobody is there to ask, rather than blocking a turn on a window that is
   * not open.
   */
  async awaitHuman(opts: { tabId?: string; reason: string; timeoutMs?: number }): Promise<HostReply> {
    try {
      const { tab } = this.resolve(opts.tabId);
      if (!this.askHuman) return fail('the browser pane is not open, so nobody can be asked');
      const requestId = `h${++this.handoffSeq}`;
      const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
      const done = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingHandoffs.delete(requestId);
          resolve(false);
        }, timeoutMs);
        timer.unref?.();
        this.pendingHandoffs.set(requestId, { resolve, timer });
        this.askHuman?.({ requestId, tabId: tab.id, reason: opts.reason });
      });
      // Whatever happened on screen, the old uids describe a page that has
      // almost certainly moved on.
      delete tab.snapshot;
      delete tab.seen;
      return ok({ tabId: tab.id, completed: done });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** The user answered the pane's hand-off banner. */
  resolveHandoff(requestId: string, completed: boolean): void {
    const pending = this.pendingHandoffs.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingHandoffs.delete(requestId);
    pending.resolve(completed);
  }

  /**
   * Ask the renderer to create a tab and wait for it to be adopted.
   *
   * Bounded: if no renderer is listening (pane closed) or it never answers,
   * this rejects with something the agent can act on instead of stalling.
   */
  async newTab(url: string, timeoutMs = 15_000): Promise<string> {
    if (!this.askRenderer) throw new Error('browser pane is not open — open it to let the agent use tabs');
    const requestId = `open${++this.openSeq}`;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOpens.delete(requestId);
        reject(new Error('timed out waiting for the browser pane to open a tab'));
      }, timeoutMs);
      timer.unref?.();
      this.pendingOpens.set(requestId, { resolve, reject, timer });
      this.askRenderer?.({ requestId, url });
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    // A listener that throws must not take the caller with it. This fires from
    // `closeAll()` during window teardown, where the obvious listener — "push
    // the tab list to the renderer" — is reaching into a window whose
    // webContents is already gone. Notification is best-effort by nature.
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        /* a listener's problem is not the host's */
      }
    }
  }

  /**
   * Adopt a `<webview>` the renderer attached. Called once per pane-created
   * tab; the renderer supplies the id, main does everything else with it.
   */
  register(webContentsId: number, requestId?: string): string {
    let id: string | undefined;
    for (const tab of this.tabs.values()) {
      if (tab.webContentsId === webContentsId) id = tab.id;
    }
    if (id === undefined) {
      id = `t${++this.counter}`;
      const tab: Tab = { id, webContentsId };
      const wc = this.lookup(webContentsId);
      if (wc?.on && wc.removeListener) {
        const announce = (): void => this.changed();
        for (const event of PAGE_CHANGE_EVENTS) wc.on(event, announce);
        tab.unwatch = () => {
          for (const event of PAGE_CHANGE_EVENTS) wc.removeListener?.(event, announce);
        };
      }
      this.tabs.set(id, tab);
      if (this.active === null) this.active = id;
      this.changed();
    }
    // Settle the agent's `newTab` if this view is the one it asked for.
    if (requestId) {
      const pending = this.pendingOpens.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingOpens.delete(requestId);
        pending.resolve(id);
      }
    }
    return id;
  }

  /** Forget a tab whose view the renderer tore down. */
  unregister(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    tab.unwatch?.();
    if (tab.idle) clearTimeout(tab.idle);
    this.detachDebugger(tab);
    this.tabs.delete(tabId);
    if (this.active === tabId) this.active = this.tabs.keys().next().value ?? null;
    // An aim at a tab that is gone would resolve to "unknown tab_id" forever.
    if (this.agentTab === tabId) this.agentTab = null;
    this.changed();
  }

  get activeId(): string | null {
    return this.active;
  }

  /**
   * Remember which tab the agent named. Only agent-facing callers do this —
   * the pane's own navigation and history buttons must not move the aim.
   */
  noteAgentTab(tabId: string): void {
    if (this.tabs.has(tabId)) this.agentTab = tabId;
  }

  /**
   * What an agent command with no `tab_id` acts on: the tab it last worked in,
   * or — before it has named one — whatever is in front.
   */
  agentTarget(): string | undefined {
    return this.agentTab ?? this.active ?? undefined;
  }

  select(tabId: string): void {
    if (!this.tabs.has(tabId)) throw new Error(`unknown tab_id ${tabId}`);
    this.active = tabId;
    this.changed();
  }

  /** Live view of the tabs, for the pane's tab strip and for every snapshot. */
  list(): TabInfo[] {
    const out: TabInfo[] = [];
    for (const tab of this.tabs.values()) {
      const wc = this.lookup(tab.webContentsId);
      if (!wc || wc.isDestroyed()) continue;
      out.push({ tabId: tab.id, url: wc.getURL(), title: wc.getTitle(), active: tab.id === this.active });
    }
    return out;
  }

  private resolve(tabId?: string): { tab: Tab; wc: HostWebContents } {
    const id = tabId ?? this.active;
    if (!id) throw new Error('no open tab');
    const tab = this.tabs.get(id);
    if (!tab) {
      const open = [...this.tabs.keys()];
      throw new Error(`unknown tab_id ${id}${open.length ? ` — open tabs: ${open.join(', ')}` : ''}`);
    }
    this.touch(tab);
    const wc = this.lookup(tab.webContentsId);
    if (!wc || wc.isDestroyed()) {
      this.tabs.delete(tab.id);
      throw new Error(`tab ${tab.id} is gone`);
    }
    return { tab, wc };
  }

  /**
   * The CDP channel for a tab. Attached lazily and left attached while the tab
   * lives — re-attaching per call would cost a round trip on every step.
   */
  private cdp(wc: HostWebContents): {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  } {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    return { send: (method, params) => wc.debugger.sendCommand(method, params ?? {}) };
  }

  /**
   * Restart a tab's countdown. Called from `resolve`, so any work at all on a
   * tab counts as the agent still being interested in it.
   */
  private touch(tab: Tab): void {
    if (tab.idle) clearTimeout(tab.idle);
    tab.idle = setTimeout(() => this.releaseTree(tab), this.idleReleaseMs);
    // Nothing here is worth keeping the process alive for.
    tab.idle.unref?.();
  }

  /**
   * Give the accessibility tree back and let go of the debugger.
   *
   * The uids stay: they point at DOM nodes, which outlive the accessibility
   * tree, and the next read re-enables the domain on its own. What is dropped is
   * the fingerprint — a page read after this gap deserves a fresh look rather
   * than an "unchanged" that skipped over whatever happened in between.
   */
  private releaseTree(tab: Tab): void {
    if (tab.idle) clearTimeout(tab.idle);
    delete tab.idle;
    delete tab.seen;
    const wc = this.lookup(tab.webContentsId);
    if (!wc || wc.isDestroyed()) return;
    try {
      if (wc.debugger.isAttached()) {
        void Promise.resolve(wc.debugger.sendCommand('Accessibility.disable', {})).catch(() => {
          // The view is going away; there is nothing left to disable.
        });
      }
    } catch {
      // As above.
    }
    this.detachDebugger(tab);
  }

  private detachDebugger(tab: Tab): void {
    const wc = this.lookup(tab.webContentsId);
    if (!wc || wc.isDestroyed()) return;
    try {
      if (wc.debugger.isAttached()) wc.debugger.detach();
    } catch {
      // Already gone; nothing to release.
    }
  }

  /**
   * Read a tab as the model reads it. Identical envelope to the sidecar
   * backend, so a tool cannot tell which one served it.
   */
  async snapshot(tabId?: string): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(tabId);
      const cdp = this.cdp(wc);
      await cdp.send('Accessibility.enable');
      const reply = (await cdp.send('Accessibility.getFullAXTree')) as { nodes?: unknown };
      const nodes = Array.isArray(reply?.nodes) ? reply.nodes : [];
      const tree = nodes.length > 0 ? buildAxTree(nodes) : null;
      const url = wc.getURL();
      const title = wc.getTitle();

      if (tree) tab.snapshot = { index: tree.index, url };
      else delete tab.snapshot;

      // Render once. The fingerprint is taken from the rendering rather than
      // from the raw CDP reply, because that is what would actually be sent —
      // and it deliberately leaves out the tab list, which another tab can
      // change without this page having moved at all.
      const body = tree
        ? formatAxTree(redactSecretValues(tree))
        : '(strona nie udostępnia drzewa dostępności)';
      const fingerprint = createHash('sha1').update(`${url}\n${title}\n${body}`).digest('hex');

      if (tab.seen === fingerprint) {
        return ok({
          text:
            `### Page\n- URL: ${url}\n- Title: ${title}\n` +
            `### Snapshot\nunchanged since your last snapshot of tab ${tab.id} — ` +
            `the uids you already have are still valid. Act, then read again.`,
          tabId: tab.id,
          url,
          nodes: tree ? tree.index.size : 0,
          unchanged: true,
        });
      }
      tab.seen = fingerprint;

      const text = formatSnapshot({ tree, url, title, tabs: this.list(), body });
      return ok({ text, tabId: tab.id, url, nodes: tree ? tree.index.size : 0 });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Act on a node the last snapshot named.
   *
   * Refuses a uid taken before the page moved. Clicking whatever now sits at
   * that position looks like success and is undetectable downstream, so this
   * is deliberately the strict direction.
   */
  async act(params: { action: string; uid: string; text?: string; tab_id?: string }): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(params.tab_id);
      const snap = tab.snapshot;
      if (!snap) return fail(`no snapshot for tab ${tab.id} — call snapshot first`);
      if (snap.url !== wc.getURL()) {
        return fail(
          `tab ${tab.id} navigated since the last snapshot (was ${snap.url}, now ${wc.getURL()}) — ` +
            `uids are stale, take a fresh snapshot`,
        );
      }
      const node = snap.index.get(params.uid);
      if (!node) return fail(`uid ${params.uid} is not in the last snapshot of tab ${tab.id}`);
      if (node.backendNodeId === undefined) return fail(`uid ${params.uid} (${node.role}) has no DOM node`);

      const cdp = this.cdp(wc);
      try {
        await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: node.backendNodeId });
      } catch {
        // Not scrollable; it may already be in view.
      }
      const box = (await cdp.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId })) as {
        model?: { content?: number[] };
      };
      const quad = box?.model?.content;
      if (!Array.isArray(quad) || quad.length < 8) return fail(`uid ${params.uid} is not visible on screen`);
      const x = (Math.min(quad[0]!, quad[2]!, quad[4]!, quad[6]!) + Math.max(quad[0]!, quad[2]!, quad[4]!, quad[6]!)) / 2;
      const y = (Math.min(quad[1]!, quad[3]!, quad[5]!, quad[7]!) + Math.max(quad[1]!, quad[3]!, quad[5]!, quad[7]!)) / 2;

      switch (params.action) {
        case 'click':
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
          break;
        case 'hover':
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
          break;
        case 'type': {
          if (typeof params.text !== 'string') return fail('text is required for type');
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
          await cdp.send('Input.insertText', { text: params.text });
          break;
        }
        default:
          return fail(`unknown action ${params.action}`);
      }
      return ok({ tabId: tab.id, url: wc.getURL() });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * A picture of the page, on demand.
   *
   * The pane does not need this to show the page — it hosts the view. This
   * exists for the two cases where a picture is the answer: the agent needs to
   * see something the accessibility tree cannot describe (a canvas), and the
   * user wants to hand a region to the agent as an attachment.
   *
   * `clip` is in CSS pixels. Capturing a region rather than the viewport is
   * what makes the vision tier affordable — a cropped element is a fraction of
   * a full-page screenshot, and it is the part anyone actually asked about.
   */
  async capture(
    opts: {
      tabId?: string;
      clip?: { x: number; y: number; width: number; height: number };
      format?: 'png' | 'jpeg';
      fullPage?: boolean;
    } = {},
  ): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(opts.tabId);
      const cdp = this.cdp(wc);
      const format = opts.format ?? 'png';
      const params: Record<string, unknown> = { format, captureBeyondViewport: opts.fullPage === true };
      if (format === 'jpeg') params.quality = 80;
      if (opts.clip) {
        if (opts.clip.width <= 0 || opts.clip.height <= 0) return fail('clip width and height must be positive');
        params.clip = { ...opts.clip, scale: 1 };
      }
      const shot = (await cdp.send('Page.captureScreenshot', params)) as { data?: string };
      if (typeof shot?.data !== 'string') return fail('the page did not return an image');
      return ok({
        tabId: tab.id,
        mediaType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        base64: shot.data,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** The box of a node the last snapshot named — lets a caller crop to it. */
  async boxOf(uid: string, tabId?: string): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(tabId);
      const snap = tab.snapshot;
      if (!snap) return fail(`no snapshot for tab ${tab.id} — call snapshot first`);
      const node = snap.index.get(uid);
      if (!node?.backendNodeId) return fail(`uid ${uid} has no DOM node`);
      const box = (await this.cdp(wc).send('DOM.getBoxModel', { backendNodeId: node.backendNodeId })) as {
        model?: { content?: number[] };
      };
      const q = box?.model?.content;
      if (!Array.isArray(q) || q.length < 8) return fail(`uid ${uid} is not visible`);
      const xs = [q[0]!, q[2]!, q[4]!, q[6]!];
      const ys = [q[1]!, q[3]!, q[5]!, q[7]!];
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return ok({ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Browser history, driven from main so the pane's buttons and the agent hit
   * the same code path. Each move invalidates the tab's snapshot for the same
   * reason `goto` does — the uids described the page being left.
   */
  async history(action: 'back' | 'forward' | 'reload', tabId?: string): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(tabId);
      if (action === 'back' && !wc.navigationHistory.canGoBack()) return fail('nothing to go back to');
      if (action === 'forward' && !wc.navigationHistory.canGoForward()) return fail('nothing to go forward to');
      delete tab.snapshot;
      delete tab.seen;
      if (action === 'back') wc.navigationHistory.goBack();
      else if (action === 'forward') wc.navigationHistory.goForward();
      else wc.reload();
      this.changed();
      return ok({ tabId: tab.id });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Release every tab. Called on quit so no debugger stays attached to a view
   * that is about to be destroyed — Electron logs a hard error for that, and a
   * still-attached debugger can delay teardown.
   */
  /**
   * Everything below the accessibility layer: reach an element by CSS selector,
   * read the page as text or markup, run an expression in it.
   *
   * This is what `browser_session` needs. It used to be answered by the
   * Playwright sidecar, which on the desktop would mean a second browser — with
   * none of the user's logins — pretending to be the one on screen. Answering it
   * here keeps the promise the bridge makes: one set of tools, either backend,
   * no way for the model to tell which it is talking to.
   */

  /** How long to keep looking for a selector before giving up. */
  private static readonly SELECTOR_TIMEOUT_MS = 10_000;

  /**
   * Resolve a selector to a DOM node, retrying while the page settles. A page
   * that is still rendering is the normal case, not an error — Playwright waits
   * here too, and failing on the first miss would make the tool useless.
   */
  private async findNode(
    cdp: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> },
    selector: string,
    timeoutMs: number,
  ): Promise<number | null> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
      const doc = (await cdp.send('DOM.getDocument', { depth: 0 })) as { root?: { nodeId?: number } };
      const rootId = doc?.root?.nodeId;
      if (rootId !== undefined) {
        const found = (await cdp.send('DOM.querySelector', { nodeId: rootId, selector })) as { nodeId?: number };
        if (found?.nodeId) {
          const described = (await cdp.send('DOM.describeNode', { nodeId: found.nodeId })) as {
            node?: { backendNodeId?: number };
          };
          if (described?.node?.backendNodeId !== undefined) return described.node.backendNodeId;
        }
      }
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Middle of an element's box in viewport coordinates, or null if it has none. */
  private async centreOf(
    cdp: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> },
    backendNodeId: number,
  ): Promise<{ x: number; y: number } | null> {
    try {
      await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
    } catch {
      // Not scrollable; it may already be in view.
    }
    const box = (await cdp.send('DOM.getBoxModel', { backendNodeId })) as { model?: { content?: number[] } };
    const q = box?.model?.content;
    if (!Array.isArray(q) || q.length < 8) return null;
    const xs = [q[0]!, q[2]!, q[4]!, q[6]!];
    const ys = [q[1]!, q[3]!, q[5]!, q[7]!];
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }

  /**
   * Press a key.
   *
   * There was no way to do this at all, and an agent that needs one has no
   * graceful fallback: seen live on Canva, where it wanted Cmd+A to replace a
   * field and went looking for a different browser rather than admit it could
   * not press a key. The sidecar backend has had this since the beginning — only
   * the desktop was missing it — so the semantics here are the sidecar's: one
   * printable character is typed, a named key is pressed.
   */
  async key(key: string, tabId?: string, focusTimeoutMs = 1500): Promise<HostReply> {
    try {
      if (!key) return fail('key is required');
      const { tab, wc } = this.resolve(tabId);
      const cdp = this.cdp(wc);

      /**
       * Put keyboard focus back on the page first.
       *
       * Every acting tool asks the user before it runs, and answering that
       * prompt means clicking in the app — which takes focus away from the page.
       * So the first key of a sequence lands and the second does not, and the
       * agent sees a field it selected and could not clear. Observed live on a
       * search box: the same sequence works with no prompt in the middle and
       * silently does nothing with one.
       */
      await this.focusView(tab, focusTimeoutMs);

      const parts = key.split('+').filter(Boolean);
      const name = parts.pop() ?? '';
      let modifiers = 0;
      for (const mod of parts) {
        const bit = MODIFIERS[mod.toLowerCase()];
        if (bit === undefined) return fail(`unknown modifier ${mod} in ${key}`);
        modifiers |= bit;
      }

      // A lone printable character is pressed as one, carrying its `text` so the
      // character actually lands. `Input.insertText` looked like the shorter
      // road and is not one: on its own, after the click that focused the field,
      // it does nothing at all. Observed against a real input.
      const printable = [...name].length === 1 && modifiers === 0;
      const spelled = spellKey(name) ?? (printable ? { key: name, code: '', code_: 0 } : null);
      if (!spelled) return fail(`unknown key ${key} — name it the way a keyboard event does, e.g. Enter, Escape, Meta+a`);

      // Modified letters do not reach the editing pipeline on their own; the
      // command does, and is what a real Cmd+A produces. Chromium takes both.
      const command = modifiers & (MOD_CONTROL | MOD_META) ? EDITING[name.toLowerCase()] : undefined;
      const event = {
        key: spelled.key,
        code: spelled.code,
        windowsVirtualKeyCode: spelled.code_,
        nativeVirtualKeyCode: spelled.code_,
        modifiers,
        ...(command ? { commands: [command] } : {}),
      };
      await cdp.send('Input.dispatchKeyEvent', {
        type: printable ? 'keyDown' : 'rawKeyDown',
        ...(printable ? { text: name } : {}),
        ...event,
      });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
      return ok({ key });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  async clickSelector(selector: string, opts: { tabId?: string; timeoutMs?: number } = {}): Promise<HostReply> {
    try {
      if (!selector) return fail('selector is required');
      const { wc } = this.resolve(opts.tabId);
      const cdp = this.cdp(wc);
      const node = await this.findNode(cdp, selector, opts.timeoutMs ?? BrowserHost.SELECTOR_TIMEOUT_MS);
      if (node === null) return fail(`nothing matched ${selector} on ${wc.getURL()}`);
      const point = await this.centreOf(cdp, node);
      if (!point) return fail(`${selector} matched an element that is not visible on screen`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      return ok({ selector });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  async fillSelector(
    selector: string,
    value: string,
    opts: { tabId?: string; timeoutMs?: number } = {},
  ): Promise<HostReply> {
    try {
      if (!selector) return fail('selector is required');
      const { wc } = this.resolve(opts.tabId);
      const cdp = this.cdp(wc);
      const node = await this.findNode(cdp, selector, opts.timeoutMs ?? BrowserHost.SELECTOR_TIMEOUT_MS);
      if (node === null) return fail(`nothing matched ${selector} on ${wc.getURL()}`);
      await cdp.send('DOM.focus', { backendNodeId: node });
      // Select what is there so the insert replaces rather than appends. Doing
      // it by selection (not by assigning `.value`) keeps the change on the real
      // input path, which is the only thing a framework-controlled field sees.
      const handle = (await cdp.send('DOM.resolveNode', { backendNodeId: node })) as {
        object?: { objectId?: string };
      };
      if (handle?.object?.objectId) {
        await cdp.send('Runtime.callFunctionOn', {
          objectId: handle.object.objectId,
          functionDeclaration: 'function () { if (typeof this.select === "function") this.select(); }',
        });
      }
      await cdp.send('Input.insertText', { text: value ?? '' });
      return ok({ selector });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  async textOf(selector?: string, tabId?: string): Promise<HostReply> {
    const expression = selector
      ? `(document.querySelector(${JSON.stringify(selector)})||{}).textContent || ""`
      : 'document.body ? document.body.innerText : ""';
    return this.evaluate(expression, tabId);
  }

  async htmlOf(tabId?: string): Promise<HostReply> {
    return this.evaluate('document.documentElement ? document.documentElement.outerHTML : ""', tabId);
  }

  async evaluate(expression: string, tabId?: string): Promise<HostReply> {
    try {
      if (!expression) return fail('expression is required');
      const { wc } = this.resolve(tabId);
      const reply = (await this.cdp(wc).send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
      if (reply?.exceptionDetails) return fail(reply.exceptionDetails.text ?? 'the expression threw');
      return ok(reply?.result?.value);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  closeAll(): void {
    for (const tab of this.tabs.values()) {
      tab.unwatch?.();
      if (tab.idle) clearTimeout(tab.idle);
      this.detachDebugger(tab);
    }
    this.tabs.clear();
    this.active = null;
    this.agentTab = null;
    for (const [, pending] of this.pendingOpens) {
      clearTimeout(pending.timer);
      pending.reject(new Error('browser is shutting down'));
    }
    this.pendingOpens.clear();
    for (const [, pending] of this.pendingHandoffs) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingHandoffs.clear();
    for (const [, waiting] of this.pendingFocus) waiting();
    this.pendingFocus.clear();
    this.changed();
  }

  /**
   * Navigate a tab. Invalidates its snapshot: those uids described the old page.
   *
   * Goes through CDP rather than `webContents.loadURL`. A `<webview>` guest has
   * its navigation mediated by the embedder, and calling `loadURL` on the guest
   * directly races that mediation — it comes back `ERR_FAILED (-2)` and leaves a
   * blank view, which is exactly what it did before this changed. `Page.navigate`
   * rides the debugger session already attached for perception, so it neither
   * fights the embedder nor needs a second channel.
   *
   * `loadURL` stays as the fallback for a view with no debugger yet.
   */
  async goto(url: string, tabId?: string): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(tabId);
      delete tab.snapshot;
      delete tab.seen;
      const reply = (await this.cdp(wc).send('Page.navigate', { url })) as { errorText?: string };
      if (reply?.errorText) return fail(`could not open ${url}: ${reply.errorText}`);
      this.changed();
      return ok({ url, tabId: tab.id });
    } catch (err) {
      // No usable debugger (a view still attaching): fall back to the embedder.
      try {
        const { tab, wc } = this.resolve(tabId);
        await wc.loadURL(url);
        this.changed();
        return ok({ url: wc.getURL(), tabId: tab.id });
      } catch {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  }
}
