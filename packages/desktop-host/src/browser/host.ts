import { createHash } from 'node:crypto';
import {
  buildAxTree,
  detectWall,
  diffRendering,
  newUidMemory,
  renderingFromText,
  formatAxTree,
  formatSnapshot,
  redactSecretValues,
  type AxNode,
  type AxNodeRaw,
  type TabInfo,
  type UidMemory,
  type WallKind,
} from '@moxxy/plugin-browser';
import {
  armPressCheck,
  coverAt,
  isDisabled,
  locate,
  pressAt,
  pressKey,
  quadOrigin,
  selectContents,
  typeCharacters,
  valueOf,
  type Cdp,
  type Point,
} from './input.js';
import { PageWatch, waitQuiet, type Dialog } from './page-watch.js';

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
    /** `sessionId` addresses a frame from another site, attached through `Target.setAutoAttach`. */
    sendCommand(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
    /** CDP events, as Electron delivers them: `(event, method, params, sessionId)`. */
    on?(event: 'message', listener: (event: unknown, method: string, params: unknown, sessionId?: string) => void): void;
    removeListener?(
      event: 'message',
      listener: (event: unknown, method: string, params: unknown, sessionId?: string) => void,
    ): void;
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
  /** The thing the page is waiting on a person for, and where to find it. */
  wall?: { kind: WallKind; backendNodeId: number; label: string };
  /** Labels this document has been using, so a uid survives the page changing. */
  uids?: UidMemory;
  /** What the last read rendered, keyed by uid, to send only what moved. */
  rendering?: Map<string, string>;
  /** Countdown to releasing this tab's accessibility tree. */
  idle?: ReturnType<typeof setTimeout>;
  /** Dialogs and navigations, followed while the debugger is attached. */
  watch?: PageWatch;
  /** Frame session → the backend node of the `<iframe>` holding it on the page, from the last read. */
  frameOwners?: Map<string, number>;
  /** Tabs this page opened (target=_blank, window.open), counted so an action can tell it caused one. */
  opened?: { count: number; last: Promise<{ tabId: string; url: string } | null> };
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

export interface HostReply {
  ok: boolean;
  result?: unknown;
  error?: { message: string };
}

const ok = (result?: unknown): HostReply => ({ ok: true, ...(result !== undefined ? { result } : {}) });
const fail = (message: string): HostReply => ({ ok: false, error: { message } });

/** Pick an option of `this` (a `<select>`) by value or label; see `selectOption`. */
const SELECT_OPTION = `function (wanted) {
  if (!(this instanceof HTMLSelectElement)) return { error: 'it is not a list of options (<select>); click it instead' };
  const label = (o) => (o.label || o.text || '').trim();
  const norm = (s) => s.trim().toLowerCase();
  const options = [...this.options];
  const option = options.find((o) => o.value === wanted) ||
    options.find((o) => norm(label(o)) === norm(wanted)) ||
    options.find((o) => norm(label(o)).includes(norm(wanted)));
  if (!option) return { error: 'no option ' + JSON.stringify(wanted) + ' — the options are: ' + options.map(label).join(', ') };
  if (option.disabled) return { error: 'option ' + JSON.stringify(label(option)) + ' is disabled' };
  this.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (setter && setter.set) setter.set.call(this, option.value); else this.value = option.value;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { selected: label(option) };
}`;

/** A function of a deadline (ms) that resolves once the text shows (or, with `gone`, stops showing). */
function waitTextExpression(text: string, gone: boolean): string {
  return `(ms) => new Promise((resolve) => {
    const wanted = ${JSON.stringify(text)};
    const met = () => ((document.body && document.body.innerText) || '').includes(wanted) !== ${gone};
    if (met()) return resolve(true);
    const observer = new MutationObserver(() => { if (met()) finish(true); });
    const timer = setTimeout(() => finish(met()), ms);
    function finish(value) { observer.disconnect(); clearTimeout(timer); resolve(value); }
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  })`;
}

/** Where the page and its scrollable parts stand, as one comparable string. */
async function scrollState(cdp: Cdp): Promise<string | null> {
  try {
    const reply = (await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const parts = [scrollX, scrollY];
        for (const el of document.querySelectorAll('*')) {
          if (el.scrollTop || el.scrollLeft) parts.push(el.scrollTop, el.scrollLeft);
        }
        return parts.join(',');
      })()`,
    })) as { result?: { value?: unknown } };
    return typeof reply?.result?.value === 'string' ? reply.result.value : null;
  } catch {
    return null;
  }
}

/** One frame of `Page.getFrameTree`. */
interface FrameTreeNode {
  readonly frame?: { id?: string };
  readonly childFrames?: ReadonlyArray<FrameTreeNode>;
}

/** Read a CDP `{ value }` wrapper as a string. */
const str = (wrapper: { value?: unknown } | undefined): string | undefined =>
  typeof wrapper?.value === 'string' ? wrapper.value : undefined;

/** An element named by a uid; see `BrowserHost.elementFor`. */
interface Element {
  readonly backendNodeId: number;
  readonly named: string;
  /** The session the element's DOM lives in: the page's, or its frame's. */
  readonly dom: Cdp;
  /** The `<iframe>` holding it on the page, when it is inside a frame from another site. */
  readonly owner?: number;
}

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
  /** `onScreen` says whether the thing being asked about is actually in view. */
  private askHuman:
    | ((req: { requestId: string; tabId: string; reason: string; onScreen: boolean; label?: string }) => void)
    | null = null;

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
  setHandoffPrompt(
    fn:
      | ((req: { requestId: string; tabId: string; reason: string; onScreen: boolean; label?: string }) => void)
      | null,
  ): void {
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
      const { tab, wc } = this.resolve(opts.tabId);
      if (!this.askHuman) return fail('the browser pane is not open, so nobody can be asked');

      /**
       * Put the thing being asked about on screen first.
       *
       * A hand-off is worth nothing if the person cannot see what it means.
       * Seen live: the pane showed one tab while the consent banner sat on
       * another, and the banner itself was near the bottom of a page nobody had
       * scrolled — so the agent asked the user to press something that was not
       * in front of them, twice. The pane fronts the tab; this scrolls to the
       * control. Best effort on purpose: a hand-off with no wall to point at is
       * still a question worth asking.
       */
      let onScreen = false;
      if (tab.wall) {
        const cdp = this.cdp(wc);
        try {
          await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: tab.wall.backendNodeId });
        } catch {
          // Not scrollable, or gone. The check below decides what to say.
        }
        onScreen = await this.elementOnScreen(cdp, tab.wall.backendNodeId);
      }
      const requestId = `h${++this.handoffSeq}`;
      const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
      const done = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingHandoffs.delete(requestId);
          resolve(false);
        }, timeoutMs);
        timer.unref?.();
        this.pendingHandoffs.set(requestId, { resolve, timer });
        this.askHuman?.({
          requestId,
          tabId: tab.id,
          reason: opts.reason,
          onScreen,
          ...(tab.wall ? { label: tab.wall.label } : {}),
        });
      });
      // Whatever happened on screen, the old uids describe a page that has
      // almost certainly moved on.
      delete tab.snapshot;
      delete tab.seen;
      delete tab.wall;
      delete tab.uids;
      delete tab.rendering;
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
        /**
         * A navigation the page made itself — a link the person clicked — ends
         * the document the labels describe. Reading the new page as a
         * difference from the old one would be describing it against nothing.
         * `did-navigate-in-page` is a fragment or a pushState: same document,
         * so the labels still hold and throwing them away would be waste.
         */
        const restart = (): void => {
          delete tab.seen;
          delete tab.wall;
          delete tab.uids;
          delete tab.rendering;
          announce();
        };
        wc.on('did-navigate', restart);
        for (const event of PAGE_CHANGE_EVENTS) {
          if (event !== 'did-navigate') wc.on(event, announce);
        }
        tab.unwatch = () => {
          wc.removeListener?.('did-navigate', restart);
          for (const event of PAGE_CHANGE_EVENTS) {
            if (event !== 'did-navigate') wc.removeListener?.(event, announce);
          }
        };
      }
      this.tabs.set(id, tab);
      /**
       * Go to the tab that was just opened.
       *
       * A view is registered exactly when someone opened a tab — the person
       * pressed plus, or the agent asked for one. Every browser goes to the tab
       * it just opened, and staying put is the surprise: you press plus and
       * nothing appears to happen.
       *
       * This moves what the person sees and nothing else. Where the agent is
       * working is tracked apart from it, which is the same separation that
       * stops a click in the tab strip from re-aiming the agent.
       */
      this.active = id;
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
    delete tab.wall;
    // The labels and the last rendering stay. Measured: after
    // `Accessibility.disable`, a detach and a re-attach, 1,636 nodes kept their
    // accessibility ids and none changed — so the memory is still true, and
    // discarding it would cost a whole tree on the next read for nothing.
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
    tab.watch?.stop();
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
  async snapshot(tabId?: string, opts: { full?: boolean } = {}): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(tabId);
      const cdp = await this.ready(tab, wc);
      // A page showing a dialog runs nothing, and its tree is not worth reading:
      // the only thing that can happen next is an answer to the dialog.
      const blocked = this.dialogBlocks(tab);
      if (blocked) {
        return ok({
          text: `### Page\n- URL: ${wc.getURL()}\n- Title: ${wc.getTitle()}\n### Dialog\n${blocked}`,
          tabId: tab.id,
          url: wc.getURL(),
          nodes: 0,
          dialog: tab.watch?.openDialog,
        });
      }
      await cdp.send('Accessibility.enable');
      const reply = (await cdp.send('Accessibility.getFullAXTree')) as { nodes?: unknown };
      const nodes = await this.withFrames(tab, wc, cdp, Array.isArray(reply?.nodes) ? (reply.nodes as AxNodeRaw[]) : []);
      // One memory per document: a node keeps its label read after read, which
      // is the whole reason a difference can be described at all.
      tab.uids ??= newUidMemory();
      const tree = nodes.length > 0 ? buildAxTree(nodes, tab.uids) : null;
      const url = wc.getURL();
      const title = wc.getTitle();

      if (tree) tab.snapshot = { index: tree.index, url };
      else delete tab.snapshot;

      // Render once. The fingerprint is taken from the rendering rather than
      // from the raw CDP reply, because that is what would actually be sent —
      // and it deliberately leaves out the tab list, which another tab can
      // change without this page having moved at all.
      const full = tree
        ? formatAxTree(redactSecretValues(tree))
        : '(strona nie udostępnia drzewa dostępności)';

      /**
       * After the first read, send what moved rather than the page again.
       *
       * A Canva task came to 2.2 million tokens, nearly all of it re-sending a
       * page that had barely changed — the agent clicks one thing and pays for
       * the whole tree. The comparison is over the rendered text, so it is
       * exactly what would have been sent, and it is keyed by uid, so a row that
       * merely shifted down is not reported as a change.
       */
      const rendering = tree ? renderingFromText(full) : new Map<string, string>();
      const previous = tab.rendering;
      const asDiff = !opts.full && previous !== undefined && tree !== null;
      const changes = asDiff ? diffRendering(previous, rendering) : null;
      const body = changes
        ? [
            'Changes since your last read of this tab. Everything else is as you last saw it;',
            'ask for the whole tree with full: true if you have lost your bearings.',
            '',
            ...changes,
          ].join('\n')
        : full;
      const wall = tree ? await this.confirmWall(cdp, tree, tab) : null;
      // A change detector, not a security primitive — but it runs over page text
      // that can carry anything the user has on screen, and sha256 is what the
      // rest of the repo uses. There is no reason to be the one exception.
      const fingerprint = createHash('sha256').update(`${url}\n${title}\n${full}`).digest('hex');

      // An empty difference is the same news as a matching fingerprint, and the
      // fingerprint is gone whenever the tree was handed back for being idle.
      // Say the short thing rather than a header with nothing under it.
      if (tab.seen === fingerprint || (changes !== null && changes.length === 0)) {
        tab.seen = fingerprint;
        tab.rendering = rendering;
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
      tab.rendering = rendering;

      const text = formatSnapshot({ tree, url, title, tabs: this.list(), body, wall });
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
   *
   * A press goes the way a person's would, and each step that can go wrong
   * says so instead of reporting a success that did not happen: the tab is
   * brought to the front (a hidden view takes no input at all), the element is
   * scrolled to, checked for being enabled and for something covering it, the
   * pointer moves there, presses, and the page is given until it settles —
   * a navigation loaded, or the DOM quiet. What the press set off comes back
   * with it: a navigation, a dialog, a tab the page opened.
   */
  async act(params: {
    action: string;
    uid: string;
    text?: string;
    submit?: boolean;
    tab_id?: string;
  }): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(params.tab_id);
      const action = params.action;
      if (action !== 'click' && action !== 'hover' && action !== 'type') return fail(`unknown action ${action}`);
      const text = params.text;
      if (action === 'type' && typeof text !== 'string') return fail('text is required for type');

      const cdp = await this.ready(tab, wc);
      const el = this.elementFor(tab, wc, params.uid);
      if ('error' in el) return fail(el.error);
      const blocked = this.dialogBlocks(tab);
      if (blocked) return fail(blocked);
      await this.focusView(tab, 1500);

      const at = await this.place(cdp, el);
      if (!at) {
        return fail(`${el.named} is not drawn on the page — it may sit in a closed menu or a hidden panel; open what holds it first`);
      }
      if (action !== 'hover') {
        if (await isDisabled(el.dom, el.backendNodeId)) return fail(`${el.named} is disabled, so pressing it does nothing`);
        let cover = await this.coverOf(cdp, el, at);
        if (cover) {
          // What covers it may be there only because of where the pointer is — a
          // menu held open by hovering, as it is after the agent opened one. A
          // hand leaves the menu before it reaches for what was under it; moving
          // straight to the target would keep the pointer inside the menu.
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0, button: 'none' });
          await waitQuiet(cdp, 100, 500);
          cover = await this.coverOf(cdp, el, at);
        }
        if (cover) {
          return fail(
            `${el.named} is covered by ${cover}, so a press would land on that instead. ` +
              `Close or move what is in the way first (or, if it asks for the user's choice, hand over with browser_await_human).`,
          );
        }
      }

      let shows: string | null = null;
      const outcome = await this.watched(tab, cdp, async () => {
        if (action === 'hover') {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.page.x, y: at.page.y, button: 'none' });
          return;
        }
        if (action === 'click') {
          await this.press(cdp, el, at);
          return;
        }
        shows = await this.typeInto(cdp, el, at, text ?? '');
        if (params.submit) {
          const problem = await pressKey(cdp, 'Enter');
          if (problem) throw new Error(problem);
        }
      });
      return ok({
        tabId: tab.id,
        ...outcome,
        ...(shows !== null ? { value: shows } : {}),
        url: wc.getURL(),
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * The DOM node a uid from the last snapshot names, or why it cannot be used.
   *
   * Refuses a uid taken before the page moved. Acting on whatever now sits at
   * that position looks like success and is undetectable downstream, so this
   * is deliberately the strict direction.
   */
  private nodeFor(
    tab: Tab,
    wc: HostWebContents,
    uid: string,
  ): { backendNodeId: number; named: string; frame?: string } | { error: string } {
    const snap = tab.snapshot;
    if (!snap) return { error: `no snapshot for tab ${tab.id} — call snapshot first` };
    if (snap.url !== wc.getURL()) {
      return {
        error:
          `tab ${tab.id} navigated since the last snapshot (was ${snap.url}, now ${wc.getURL()}) — ` +
          `uids are stale, take a fresh snapshot`,
      };
    }
    const node = snap.index.get(uid);
    if (!node) return { error: `uid ${uid} is not in the last snapshot of tab ${tab.id}` };
    if (node.backendNodeId === undefined) return { error: `uid ${uid} (${node.role}) has no DOM node` };
    return {
      backendNodeId: node.backendNodeId,
      named: `uid ${uid} (${node.role}${node.name ? ` "${node.name}"` : ''})`,
      ...(node.frame !== undefined ? { frame: node.frame } : {}),
    };
  }

  /**
   * A uid as something to act on: its DOM node, the session that DOM lives in
   * (the page's, or a frame's from another site), and the `<iframe>` holding it.
   */
  private elementFor(tab: Tab, wc: HostWebContents, uid: string): Element | { error: string } {
    const found = this.nodeFor(tab, wc, uid);
    if ('error' in found) return found;
    if (found.frame === undefined) return { ...found, dom: this.cdp(wc) };
    const owner = tab.frameOwners?.get(found.frame);
    if (owner === undefined) return { error: `${found.named} is in a frame that has gone — take a fresh snapshot` };
    return { backendNodeId: found.backendNodeId, named: found.named, dom: this.frameCdp(wc, found.frame), owner };
  }

  /** A frame's own session, for a frame from another site. */
  private frameCdp(wc: HostWebContents, sessionId: string): Cdp {
    return { send: (method, params) => wc.debugger.sendCommand(method, params ?? {}, sessionId) };
  }

  /**
   * Scroll an element into view and say where it is: on the page (where input
   * is dispatched) and inside its own document (where it is checked). They are
   * the same point unless the element is in a frame from another site, whose
   * coordinates start at the frame's corner.
   */
  private async place(cdp: Cdp, el: Element): Promise<{ page: Point; local: Point } | null> {
    if (el.owner === undefined) {
      const point = await locate(cdp, el.backendNodeId);
      return point ? { page: point, local: point } : null;
    }
    if (!(await locate(cdp, el.owner))) return null;
    const box = (await cdp.send('DOM.getBoxModel', { backendNodeId: el.owner })) as { model?: { content?: unknown } };
    const corner = quadOrigin(box?.model?.content);
    const local = await locate(el.dom, el.backendNodeId);
    if (!corner || !local) return null;
    return { page: { x: corner.x + local.x, y: corner.y + local.y }, local };
  }

  /** What a press would land on instead: inside the element's document, then on the page around its frame. */
  private async coverOf(cdp: Cdp, el: Element, at: { page: Point; local: Point }): Promise<string | null> {
    const inside = await coverAt(el.dom, el.backendNodeId, at.local);
    if (inside || el.owner === undefined) return inside;
    return coverAt(cdp, el.owner, at.page);
  }

  /**
   * The page's tree with every frame read into it.
   *
   * `Accessibility.getFullAXTree` describes one document; a frame — an embedded
   * form, a video, a payment field — shows up as an empty `Iframe` node where
   * it sits. Seen live on the edge fixture, whose "Ramka testowa" read as
   * empty. A frame from the same site is read through the page's session by
   * its frame id; a frame from another site lives in another process and is
   * read through its own session, and its nodes are tagged with that session,
   * which is where an action on one of them must go. Each frame's tree hangs
   * under its `Iframe` node, node ids prefixed with the frame's id so they
   * cannot collide with the page's.
   */
  private async withFrames(tab: Tab, wc: HostWebContents, cdp: Cdp, nodes: AxNodeRaw[]): Promise<AxNodeRaw[]> {
    tab.frameOwners = new Map();
    const owners = nodes.filter((n) => str(n.role) === 'Iframe').length;
    if (owners === 0) return nodes;
    const watch = tab.watch?.watching ? tab.watch : undefined;
    // A frame from another site attaches a moment after the page is first
    // watched; reading before it does would show that frame empty.
    if (watch) await watch.waitForFrames(owners, 500);
    const sessions = new Map((watch?.frames ?? []).map((f) => [f.targetId, f.sessionId]));
    const out = [...nodes];

    const graft = async (frameId: string, read: Cdp, sessionId: string | undefined): Promise<void> => {
      try {
        const owner = (await cdp.send('DOM.getFrameOwner', { frameId })) as { backendNodeId?: number };
        const ownerId = owner?.backendNodeId;
        const at = out.findIndex((n) => n.backendDOMNodeId === ownerId && n.frame === undefined);
        const holder = out[at];
        if (ownerId === undefined || !holder) return;
        await read.send('Accessibility.enable');
        const reply = (await read.send('Accessibility.getFullAXTree', sessionId ? {} : { frameId })) as { nodes?: unknown };
        const found = Array.isArray(reply?.nodes) ? (reply.nodes as AxNodeRaw[]) : [];
        const first = found[0];
        if (!first) return;
        const key = (id: string): string => `${frameId}:${id}`;
        out[at] = { ...holder, childIds: [...(holder.childIds ?? []), key(first.nodeId)] };
        for (const node of found) {
          out.push({
            ...node,
            nodeId: key(node.nodeId),
            ...(node.childIds ? { childIds: node.childIds.map(key) } : {}),
            ...(sessionId ? { frame: sessionId } : {}),
          });
        }
        if (sessionId) tab.frameOwners?.set(sessionId, ownerId);
      } catch {
        // A frame that went away mid-read, or will not answer: the page is still read.
      }
    };

    try {
      // Frames from the page's own site. The page's frame tree leaves out the
      // ones from other sites — measured in Electron — so those come after.
      const tree = (await cdp.send('Page.getFrameTree')) as { frameTree?: FrameTreeNode };
      const pending = [...(tree?.frameTree?.childFrames ?? [])];
      // Parents before children, so a frame's holder is already in the tree.
      while (pending.length > 0) {
        const next = pending.shift();
        const frameId = next?.frame?.id;
        if (!frameId || sessions.has(frameId)) continue;
        await graft(frameId, cdp, undefined);
        pending.push(...(next.childFrames ?? []));
      }
    } catch {
      // No frame tree to walk: the page alone is still a page.
    }
    for (const [targetId, sessionId] of sessions) await graft(targetId, this.frameCdp(wc, sessionId), sessionId);
    return out;
  }

  /**
   * Choose an option in a `<select>`, by its label or value.
   *
   * A native select opens its list in a popup Chromium draws outside the page,
   * which no press on the page can reach — the agent clicked the list, pressed
   * ArrowDown and Enter, and the select still said "— wybierz —". Seen live.
   * Set the way the page's own change handlers expect: through the element's
   * value setter, then `input` and `change`.
   */
  async selectOption(params: { uid: string; option: string; tabId?: string }): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(params.tabId);
      const cdp = await this.ready(tab, wc);
      const found = this.elementFor(tab, wc, params.uid);
      if ('error' in found) return fail(found.error);
      const blocked = this.dialogBlocks(tab);
      if (blocked) return fail(blocked);
      await this.focusView(tab, 1500);
      if (!(await this.place(cdp, found))) return fail(`${found.named} is not drawn on the page`);
      if (await isDisabled(found.dom, found.backendNodeId)) return fail(`${found.named} is disabled`);
      let selected = '';
      const outcome = await this.watched(tab, cdp, async () => {
        const handle = (await found.dom.send('DOM.resolveNode', { backendNodeId: found.backendNodeId })) as {
          object?: { objectId?: string };
        };
        const objectId = handle?.object?.objectId;
        if (!objectId) throw new Error(`${found.named} is gone from the page`);
        const reply = (await found.dom.send('Runtime.callFunctionOn', {
          objectId,
          arguments: [{ value: params.option }],
          returnByValue: true,
          functionDeclaration: SELECT_OPTION,
        })) as { result?: { value?: { selected?: string; error?: string } } };
        const value = reply?.result?.value;
        if (!value || value.error) throw new Error(`${found.named}: ${value?.error ?? 'the page did not answer'}`);
        selected = value.selected ?? params.option;
      });
      return ok({ tabId: tab.id, selected, ...outcome, url: wc.getURL() });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Scroll the page, or the scrollable part a uid sits in, by screens.
   *
   * A wheel at a point is what scrolls the thing under it — the page, or a
   * list inside it — and it is what loads the next part of a lazily loaded
   * list. Reports whether anything moved, so "scroll again" is never a guess.
   */
  async scroll(params: { direction: 'up' | 'down'; screens?: number; uid?: string; tabId?: string }): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(params.tabId);
      const cdp = await this.ready(tab, wc);
      const blocked = this.dialogBlocks(tab);
      if (blocked) return fail(blocked);
      await this.focusView(tab, 1500);
      const metrics = (await cdp.send('Page.getLayoutMetrics')) as {
        cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
      };
      const width = metrics?.cssVisualViewport?.clientWidth ?? 800;
      const height = metrics?.cssVisualViewport?.clientHeight ?? 600;
      let point: Point = { x: width / 2, y: height / 2 };
      if (params.uid) {
        const found = this.elementFor(tab, wc, params.uid);
        if ('error' in found) return fail(found.error);
        const at = await this.place(cdp, found);
        if (!at) return fail(`${found.named} is not drawn on the page`);
        point = at.page;
      }
      const screens = Math.min(Math.max(params.screens ?? 1, 0.25), 10);
      const deltaY = (params.direction === 'down' ? 1 : -1) * Math.round(height * 0.8 * screens);
      const before = await scrollState(cdp);
      const outcome = await this.watched(tab, cdp, async () => {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY });
      });
      const after = await scrollState(cdp);
      return ok({
        tabId: tab.id,
        moved: before === null || after === null ? null : before !== after,
        ...outcome,
        url: wc.getURL(),
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Wait until the page shows a text, or stops showing it.
   *
   * For the moment between an action and its answer that the settle wait does
   * not cover: a search still running, a file still uploading. Wakes on the
   * page's own mutations, and a deadline answers "not yet", never "yes".
   */
  async waitFor(params: { text: string; gone?: boolean; timeoutMs?: number; tabId?: string }): Promise<HostReply> {
    try {
      if (!params.text) return fail('text is required');
      const { tab, wc } = this.resolve(params.tabId);
      const cdp = await this.ready(tab, wc);
      const blocked = this.dialogBlocks(tab);
      if (blocked) return fail(blocked);
      const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 10_000, 0), 30_000);
      const deadline = Date.now() + timeoutMs;
      const expression = waitTextExpression(params.text, params.gone === true);
      for (;;) {
        const left = deadline - Date.now();
        const mark = tab.watch?.watching ? tab.watch.mark() : undefined;
        try {
          const reply = (await cdp.send('Runtime.evaluate', {
            expression: `(${expression})(${Math.max(0, left)})`,
            awaitPromise: true,
            returnByValue: true,
          })) as { result?: { value?: unknown } };
          const met = reply?.result?.value === true;
          return ok({ tabId: tab.id, met, url: wc.getURL(), ...(met ? {} : { waitedMs: timeoutMs }) });
        } catch {
          // The document was replaced mid-wait. Give the new one its load, then look again.
          if (Date.now() >= deadline) return ok({ tabId: tab.id, met: false, url: wc.getURL(), waitedMs: timeoutMs });
          if (tab.watch && mark) await tab.watch.waitLoad(mark, Math.max(0, deadline - Date.now()));
        }
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Answer the dialog a page is showing: accept or dismiss it, with the text a
   * prompt asks for. Until this happens the page runs no script at all.
   */
  async answerDialog(params: { accept: boolean; text?: string; tabId?: string }): Promise<HostReply> {
    try {
      const { tab, wc } = this.resolve(params.tabId);
      const cdp = await this.ready(tab, wc);
      const open = tab.watch?.openDialog;
      if (!open) return fail(`no dialog is open on tab ${tab.id}`);
      const outcome = await this.watched(tab, cdp, async () => {
        await cdp.send('Page.handleJavaScriptDialog', {
          accept: params.accept,
          ...(params.text !== undefined ? { promptText: params.text } : {}),
        });
      });
      return ok({
        tabId: tab.id,
        answered: { ...open, result: params.accept ? 'accepted' : 'dismissed' },
        ...outcome,
        url: wc.getURL(),
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * A page asked for a new window — a `target=_blank` link, `window.open`.
   *
   * It becomes a tab in the pane. Left to Electron it opened as a bare window
   * of its own: off to one side of the app, outside the pane the user watches,
   * and invisible to the agent, whose click looked like it did nothing.
   */
  openFromPage(openerWebContentsId: number, url: string): void {
    if (!/^https?:\/\//i.test(url) && url !== 'about:blank') return;
    let opener: Tab | undefined;
    for (const tab of this.tabs.values()) {
      if (tab.webContentsId === openerWebContentsId) opener = tab;
    }
    const last = this.newTab(url).then(
      (tabId) => ({ tabId, url }),
      () => null,
    );
    if (opener) opener.opened = { count: (opener.opened?.count ?? 0) + 1, last };
  }

  /** The CDP channel for a tab, with its dialogs and navigations watched. */
  private async ready(tab: Tab, wc: HostWebContents): Promise<Cdp> {
    const cdp = this.cdp(wc);
    tab.watch ??= new PageWatch(wc.debugger);
    if (!tab.watch.watching) await tab.watch.start(cdp);
    return cdp;
  }

  /** Why nothing can be done on this tab right now, if a dialog is holding it. */
  private dialogBlocks(tab: Tab): string | null {
    const open = tab.watch?.openDialog;
    if (!open) return null;
    return (
      `a ${open.type} dialog is open on tab ${tab.id} ("${open.message}") and the page is frozen until it is answered — ` +
      `accept or dismiss it with browser_dialog first`
    );
  }

  /** Press at an element's place on the page and confirm its document felt it. */
  private async press(cdp: Cdp, el: Element, at: { page: Point }): Promise<void> {
    const felt = await armPressCheck(el.dom, el.backendNodeId, 2000);
    await pressAt(cdp, at.page);
    if (!(await felt())) {
      throw new Error(
        'the press did not reach the page — the tab is not on screen (the browser pane may be closed or showing another tab). ' +
          'Ask the user to open the browser pane, then try again.',
      );
    }
  }

  /**
   * Put text into a field, replacing what it held.
   *
   * Clicked first, the way a person focuses a field, so the page's own focus
   * handlers run; then everything in it is selected and the text inserted over
   * the selection — which is the input path a framework-controlled field
   * actually listens to. A field that still does not show the text gets it a
   * character at a time. Returns what the field shows when that is not the
   * text: a field that formats its input (a phone number, a date) is not an
   * error, but the agent should know what it now says.
   */
  private async typeInto(cdp: Cdp, el: Element, at: { page: Point }, text: string): Promise<string | null> {
    const id = el.backendNodeId;
    if ((await valueOf(el.dom, id)) === text) return null;
    await this.press(cdp, el, at);
    await selectContents(el.dom, id);
    if (text) await cdp.send('Input.insertText', { text });
    else await pressKey(cdp, 'Delete');
    let shows = await valueOf(el.dom, id);
    if (shows !== null && shows !== text) {
      await selectContents(el.dom, id);
      await pressKey(cdp, 'Delete');
      await typeCharacters(cdp, text);
      shows = await valueOf(el.dom, id);
    }
    return shows === null || shows === text ? null : shows;
  }

  /**
   * Run something that acts on the page and report what it set off.
   *
   * A dialog the action opens is noticed while the action is still in flight:
   * an alert is accepted on the spot (it has one button and says something
   * worth passing on); a confirm or prompt is left open for the agent to answer
   * with browser_dialog, because that answer is a decision. Then the page is
   * given until it settles: a navigation to load, or the DOM to go quiet. A
   * deadline means "still going", reported as such, never as finished.
   */
  private async watched(
    tab: Tab,
    cdp: Cdp,
    run: () => Promise<void>,
  ): Promise<{
    navigated?: true;
    loading?: true;
    dialog?: Dialog & { open?: true; result?: 'accepted' };
    opened?: { tabId: string; url: string };
  }> {
    const watch = tab.watch?.watching ? tab.watch : undefined;
    const mark = watch?.mark();
    const openedBefore = tab.opened?.count ?? 0;
    let dialog: (Dialog & { open?: true; result?: 'accepted' }) | undefined;

    const opening = watch?.nextDialog();
    const running = run();
    // An action left waiting on an open confirm finishes whenever that is answered.
    running.catch(() => {});
    if (opening) {
      const first = await Promise.race([running.then(() => null), opening.promise]);
      opening.cancel();
      if (first && first.type !== 'alert') return { dialog: { ...first, open: true } };
      if (first) {
        await cdp.send('Page.handleJavaScriptDialog', { accept: true });
        dialog = { ...first, result: 'accepted' };
      }
    }
    await running;

    const later = watch?.nextDialog();
    await Promise.race([waitQuiet(cdp, 250, 1500), ...(later ? [later.promise] : [])]);
    later?.cancel();
    const lateDialog = watch?.openDialog;
    if (lateDialog && !dialog) dialog = { ...lateDialog, open: true };

    let navigated = false;
    let loading = false;
    if (watch && mark && watch.navigatedSince(mark)) {
      navigated = true;
      loading = !(await watch.waitLoad(mark, 3000));
    }

    let opened: { tabId: string; url: string } | null = null;
    const popup = tab.opened;
    if (popup && popup.count > openedBefore) {
      opened = await Promise.race([popup.last, new Promise<null>((r) => setTimeout(() => r(null), 3000).unref?.())]);
    }
    if (navigated) this.changed();
    return {
      ...(navigated ? { navigated: true as const } : {}),
      ...(loading ? { loading: true as const } : {}),
      ...(dialog ? { dialog } : {}),
      ...(opened ? { opened } : {}),
    };
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
      delete tab.wall;
      delete tab.uids;
      delete tab.rendering;
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
      const cdp = await this.ready(tab, wc);

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

      const blocked = this.dialogBlocks(tab);
      if (blocked) return fail(blocked);
      const outcome = await this.watched(tab, cdp, async () => {
        const problem = await pressKey(cdp, key);
        if (problem) throw new Error(problem);
      });
      return ok({ key, ...outcome });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Whether this page is really waiting on a person.
   *
   * The detector reads the accessibility tree, which is enough to spot a consent
   * button or a password field and not enough to know either is rendered. A
   * control can sit in the tree with nothing drawn for it — `display: none`, a
   * collapsed container, a leftover from a banner already dismissed — and a wall
   * reported from one of those traps the agent in a hand-off nobody can answer.
   *
   * A box settles exactly that and no more. It is layout, not visibility: an
   * element far down the page has a perfectly good box. That is deliberate — a
   * consent banner below the fold is still a real wall — and it is why
   * `awaitHuman` scrolls to the thing and checks it arrived before anyone is
   * asked about it.
   */
  private async confirmWall(
    cdp: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> },
    // AxTree is the root node with an index hung off it, so one value is both.
    tree: AxNode & { index: ReadonlyMap<string, AxNode> },
    tab: Tab,
  ): Promise<WallKind | null> {
    delete tab.wall;
    const found = detectWall(tree);
    if (!found) return null;
    const node = tree.index.get(found.uid);
    if (node?.backendNodeId === undefined) return null;
    try {
      const box = (await cdp.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId })) as {
        model?: { content?: number[] };
      };
      const q = box?.model?.content;
      if (!Array.isArray(q) || q.length < 8) return null;
      const width = Math.max(q[0]!, q[2]!, q[4]!, q[6]!) - Math.min(q[0]!, q[2]!, q[4]!, q[6]!);
      const height = Math.max(q[1]!, q[3]!, q[5]!, q[7]!) - Math.min(q[1]!, q[3]!, q[5]!, q[7]!);
      if (!(width > 0 && height > 0)) return null;
      // Kept so the hand-off can scroll to it: asking is the easy half.
      tab.wall = {
        kind: found.kind,
        backendNodeId: node.backendNodeId,
        // Carried so the pane can name the thing. "Press Done" next to a
        // description of something the person cannot find is how a hand-off
        // becomes a guessing game.
        label: node.name || node.role,
      };
      return found.kind;
    } catch {
      // No box is the same answer as an empty one: nothing to point a person at.
      return null;
    }
  }

  /**
   * Whether the page itself considers this element to be on screen.
   *
   * `DOM.getBoxModel` answers a different question — "is this laid out" — and an
   * element far down the page has a perfectly good box. Asking the element for
   * its own `getBoundingClientRect` against the viewport is the only form of the
   * question that means what it sounds like.
   */
  private async elementOnScreen(
    cdp: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> },
    backendNodeId: number,
  ): Promise<boolean> {
    try {
      const handle = (await cdp.send('DOM.resolveNode', { backendNodeId })) as { object?: { objectId?: string } };
      const objectId = handle?.object?.objectId;
      if (!objectId) return false;
      const reply = (await cdp.send('Runtime.callFunctionOn', {
        objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          const r = this.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
        }`,
      })) as { result?: { value?: unknown } };
      return reply?.result?.value === true;
    } catch {
      // Gone, or a page that will not answer. Treat as not on screen: the
      // honest answer when we cannot tell is that we cannot show it.
      return false;
    }
  }

  async clickSelector(selector: string, opts: { tabId?: string; timeoutMs?: number } = {}): Promise<HostReply> {
    try {
      if (!selector) return fail('selector is required');
      const { wc } = this.resolve(opts.tabId);
      const cdp = this.cdp(wc);
      const node = await this.findNode(cdp, selector, opts.timeoutMs ?? BrowserHost.SELECTOR_TIMEOUT_MS);
      if (node === null) return fail(`nothing matched ${selector} on ${wc.getURL()}`);
      const point = await locate(cdp, node);
      if (!point) return fail(`${selector} matched an element that is not visible on screen`);
      await pressAt(cdp, point);
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
      delete tab.wall;
      delete tab.uids;
      delete tab.rendering;
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
