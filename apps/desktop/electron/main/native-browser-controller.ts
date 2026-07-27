import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

import {
  Menu,
  WebContentsView,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type Debugger,
  type DownloadItem,
  type MenuItemConstructorOptions,
  type NativeImage,
  type Session,
  type WebContents,
} from 'electron';
import {
  NativeBrowserState,
  NativeBrowserStateStore,
  projectNativeBrowserBounds,
  type NativeBrowserController,
  type NativeBrowserAgentAction,
} from '@moxxy/desktop-host/native-browser';
import type { BrowserTarget } from '@moxxy/plugin-browser/browser-action';
import {
  buildAccessibilityObservationNodes,
  buildBrowserObservationScript,
  buildBrowserRefPointScript,
  buildBrowserRefValidationScript,
  buildBrowserSelectorPointScript,
  buildSanitizedDocumentHtmlScript,
  formatBrowserObservationForModel,
  parseBrowserObservation,
  type BrowserObservationNode,
  type BrowserObservationTarget,
} from '@moxxy/plugin-browser/browser-observation';
import type {
  NativeBrowserAvailability,
  NativeBrowserCapture,
  NativeBrowserDownload,
  NativeBrowserPermissionRequest,
  NativeBrowserRect,
  NativeBrowserSitePermission,
  NativeBrowserSnapshot,
  NativeBrowserTabSnapshot,
  NativeBrowserViewport,
} from '@moxxy/desktop-ipc-contract';
import { assertPublicUrl } from '@moxxy/plugin-browser/ssrf-guard';
import { BrowserOperationError } from '@moxxy/plugin-browser/browser-errors';

const BROWSER_PARTITION = 'persist:moxxy-browser-v1';
const BLANK_URL = 'about:blank';
const DEVTOOLS_PROTOCOL_VERSION = '1.3';
const NETWORK_IDLE_MS = 500;
const MAX_FULL_PAGE_DIMENSION = 16_384;
const MAX_FULL_PAGE_PIXELS = 12_000_000;

interface NativeBrowserControllerOptions {
  readonly browserSession: Session;
  readonly userDataDir: string;
  readonly downloadsDir: string;
  readonly getMainWindow: () => BrowserWindow | null;
  readonly onChanged: (workspaceId: string, snapshot: NativeBrowserSnapshot) => void;
  readonly backendOverride?: string;
  readonly createView?: (webContents?: WebContents) => WebContentsView;
}

type PopupWindowOptions = BrowserWindowConstructorOptions & {
  readonly webContents?: WebContents;
};

type PopupDisposition =
  | 'default'
  | 'foreground-tab'
  | 'background-tab'
  | 'new-window'
  | 'other';

interface CaptureState {
  readonly workspaceId: string;
  readonly tabId: string;
  readonly image: NativeImage;
  readonly viewBounds: NativeBrowserRect;
}

interface PendingPermission {
  readonly workspaceId: string;
  readonly request: NativeBrowserPermissionRequest;
  readonly callback: (allowed: boolean) => void;
}

interface ActiveDownload {
  readonly workspaceId: string;
  readonly item: DownloadItem;
  snapshot: NativeBrowserDownload;
}

/** Owns every third-party WebContents used by the Moxxy Browser. The app
 * renderer sees only snapshots and geometry IPC; it never receives a
 * WebContents handle or any Electron primitive. */
export class ElectronNativeBrowserController implements NativeBrowserController {
  private readonly state = new NativeBrowserState(randomUUID);
  private readonly store: NativeBrowserStateStore;
  private readonly views = new Map<string, WebContentsView>();
  private readonly activeAgentOperations = new WeakMap<WebContentsView, number>();
  private readonly observations = new WeakMap<
    WebContentsView,
    Map<string, ReadonlyMap<string, BrowserObservationTarget>>
  >();
  private readonly debuggerQueues = new WeakMap<WebContentsView, Promise<void>>();
  private readonly syntheticInputDepth = new WeakMap<WebContentsView, number>();
  private readonly pendingNetworkRequests = new Map<number, Set<number>>();
  private readonly networkActivityListeners = new Map<number, Set<() => void>>();
  private readonly bounds = new Map<string, NativeBrowserRect>();
  private readonly agentControls = new Map<string, Set<AbortController>>();
  private readonly agentControlState = new Map<
    string,
    { readonly action: string; readonly startedAtMs: number }
  >();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly permissionGrants = new Set<string>();
  private readonly downloads = new Map<string, ActiveDownload>();
  private readonly reservedDownloadPaths = new Set<string>();
  private readonly intentionalClosures = new WeakSet<WebContentsView>();
  private backend: NativeBrowserAvailability = { backend: 'playwright', available: true };
  private visibleWorkspaceId: string | null = null;
  private attachedKey: string | null = null;
  private attachedWindowId: number | null = null;
  private capture: CaptureState | null = null;
  private started = false;
  private destroying = false;

  constructor(private readonly options: NativeBrowserControllerOptions) {
    this.store = new NativeBrowserStateStore(
      path.join(options.userDataDir, 'native-browser', 'tabs-v1.json'),
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.options.backendOverride?.trim().toLowerCase() === 'playwright') {
      this.backend = {
        backend: 'playwright',
        available: true,
        reason: 'Native browser disabled by MOXXY_BROWSER_BACKEND=playwright',
      };
      return;
    }

    try {
      this.installSessionSecurity();
      this.state.restore(await this.store.load());
      this.backend = { backend: 'native', available: true };
    } catch (error) {
      this.backend = {
        backend: 'playwright',
        available: true,
        reason: `Native browser startup failed: ${errorMessage(error)}`,
      };
    }
  }

  status(): Promise<NativeBrowserAvailability> {
    return Promise.resolve({ ...this.backend });
  }

  /** Startup-only fallback. The main process calls this before any runner or
   * pane is opened when the local bridge cannot bind, keeping panel and agent
   * on one complete Playwright backend instead of splitting them. */
  disableNative(reason: string): void {
    if (this.views.size > 0 || this.visibleWorkspaceId) {
      throw new Error('native browser backend cannot change after use');
    }
    this.backend = { backend: 'playwright', available: true, reason };
  }

  async open(args: { workspaceId: string }): Promise<NativeBrowserSnapshot> {
    this.requireNative();
    const snapshot = this.state.ensureWorkspace(args.workspaceId);
    for (const tab of snapshot.tabs) this.ensureView(args.workspaceId, tab);
    await this.setVisible({ workspaceId: args.workspaceId, visible: true });
    return this.snapshot(args.workspaceId);
  }

  async setVisible(args: { workspaceId: string; visible: boolean }): Promise<void> {
    this.requireNative();
    this.state.ensureWorkspace(args.workspaceId);
    if (!args.visible) {
      this.state.setVisible(args.workspaceId, false);
      if (this.visibleWorkspaceId === args.workspaceId) {
        this.visibleWorkspaceId = null;
        this.detachAttachedView();
      }
      this.publish(args.workspaceId);
      return;
    }

    const previous = this.visibleWorkspaceId;
    if (previous && previous !== args.workspaceId) {
      this.state.setVisible(previous, false);
      this.publish(previous);
    }
    this.visibleWorkspaceId = args.workspaceId;
    this.state.setVisible(args.workspaceId, true);
    this.attachActiveView(args.workspaceId);
    this.publish(args.workspaceId);
  }

  async setBounds(args: {
    workspaceId: string;
    rect: NativeBrowserRect;
    rendererViewport: NativeBrowserViewport;
  }): Promise<void> {
    this.requireNative();
    const window = this.mustWindow();
    const contentBounds = window.contentView.getBounds();
    const projected = projectNativeBrowserBounds({
      rect: args.rect,
      rendererViewport: args.rendererViewport,
      contentBounds: { width: contentBounds.width, height: contentBounds.height },
    });
    this.bounds.set(args.workspaceId, projected);
    if (this.visibleWorkspaceId === args.workspaceId && !this.capture) {
      this.attachActiveView(args.workspaceId);
    }
  }

  async navigate(args: { workspaceId: string; url: string; tabId?: string }): Promise<void> {
    this.requireNative();
    const target = this.captureTarget(args.workspaceId, args.tabId);
    await assertPublicUrl(args.url, 'native_browser', { failClosed: true });
    const view = this.mustView(args.workspaceId, target);
    this.state.updateTab(args.workspaceId, target.id, { url: args.url, loading: true });
    this.publish(args.workspaceId);
    await this.withAgentOperation(view, () => view.webContents.loadURL(args.url));
  }

  async back(args: { workspaceId: string; tabId?: string }): Promise<void> {
    const target = this.captureTarget(args.workspaceId, args.tabId);
    const view = this.mustView(args.workspaceId, target);
    if (!view.webContents.navigationHistory.canGoBack()) return;
    await this.withAgentOperation(view, async () => {
      view.webContents.navigationHistory.goBack();
    });
  }

  async forward(args: { workspaceId: string; tabId?: string }): Promise<void> {
    const target = this.captureTarget(args.workspaceId, args.tabId);
    const view = this.mustView(args.workspaceId, target);
    if (!view.webContents.navigationHistory.canGoForward()) return;
    await this.withAgentOperation(view, async () => {
      view.webContents.navigationHistory.goForward();
    });
  }

  async reload(args: { workspaceId: string; tabId?: string }): Promise<void> {
    const target = this.captureTarget(args.workspaceId, args.tabId);
    const view = this.mustView(args.workspaceId, target);
    await this.withAgentOperation(view, async () => {
      view.webContents.reload();
    });
  }

  async setZoom(args: { workspaceId: string; tabId?: string; zoom: number }): Promise<void> {
    const target = this.captureTarget(args.workspaceId, args.tabId);
    const view = this.mustView(args.workspaceId, target);
    view.webContents.setZoomFactor(args.zoom);
    this.state.updateTab(args.workspaceId, target.id, { zoom: args.zoom });
    this.publish(args.workspaceId);
  }

  async newTab(args: { workspaceId: string; url?: string }): Promise<NativeBrowserSnapshot> {
    this.requireNative();
    this.state.ensureWorkspace(args.workspaceId);
    if (args.url) await assertPublicUrl(args.url, 'native_browser', { failClosed: true });
    const tab = this.state.newTab(args.workspaceId, args.url ?? BLANK_URL);
    this.ensureView(args.workspaceId, tab);
    if (this.visibleWorkspaceId === args.workspaceId) this.attachActiveView(args.workspaceId);
    this.publish(args.workspaceId);
    await this.persist();
    return this.snapshot(args.workspaceId);
  }

  async selectTab(args: { workspaceId: string; tabId: string }): Promise<NativeBrowserSnapshot> {
    this.requireNative();
    this.state.selectTab(args.workspaceId, args.tabId);
    if (this.visibleWorkspaceId === args.workspaceId && !this.capture) {
      this.attachActiveView(args.workspaceId);
    }
    this.publish(args.workspaceId);
    await this.persist();
    return this.snapshot(args.workspaceId);
  }

  async closeTab(args: { workspaceId: string; tabId: string }): Promise<NativeBrowserSnapshot> {
    this.requireNative();
    const key = viewKey(args.workspaceId, args.tabId);
    if (this.attachedKey === key) this.detachAttachedView();
    const view = this.views.get(key);
    this.views.delete(key);
    if (view && !view.webContents.isDestroyed()) {
      this.intentionalClosures.add(view);
      view.webContents.close();
    }
    if (this.capture?.workspaceId === args.workspaceId && this.capture.tabId === args.tabId) {
      this.capture = null;
    }
    this.state.closeTab(args.workspaceId, args.tabId);
    const snapshot = this.snapshot(args.workspaceId);
    const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
    if (!active) throw new Error('native browser active tab missing after close');
    this.ensureView(args.workspaceId, active);
    if (this.visibleWorkspaceId === args.workspaceId) this.attachActiveView(args.workspaceId);
    this.publish(args.workspaceId);
    await this.persist();
    return this.snapshot(args.workspaceId);
  }

  async beginCapture(args: { workspaceId: string; tabId?: string }): Promise<NativeBrowserCapture> {
    this.requireNative();
    const target = this.captureTarget(args.workspaceId, args.tabId);
    const view = this.mustView(args.workspaceId, target);
    const image = await view.webContents.capturePage();
    const viewBounds = view.getBounds();
    this.capture = {
      workspaceId: args.workspaceId,
      tabId: target.id,
      image,
      viewBounds,
    };
    if (this.attachedKey === viewKey(args.workspaceId, target.id)) this.detachAttachedView();
    return encodeCapture(image);
  }

  async endCapture(args: {
    workspaceId: string;
    tabId?: string;
    rect?: NativeBrowserRect;
  }): Promise<NativeBrowserCapture | null> {
    this.requireNative();
    const capture = this.capture;
    this.capture = null;
    if (this.visibleWorkspaceId === args.workspaceId) this.attachActiveView(args.workspaceId);
    if (!capture || capture.workspaceId !== args.workspaceId) return null;
    if (args.tabId && args.tabId !== capture.tabId) return null;
    if (!args.rect) return null;
    const imageSize = capture.image.getSize();
    const scaleX = imageSize.width / capture.viewBounds.width;
    const scaleY = imageSize.height / capture.viewBounds.height;
    const crop = {
      x: Math.max(0, Math.round(args.rect.x * scaleX)),
      y: Math.max(0, Math.round(args.rect.y * scaleY)),
      width: Math.min(imageSize.width, Math.round(args.rect.width * scaleX)),
      height: Math.min(imageSize.height, Math.round(args.rect.height * scaleY)),
    };
    if (crop.x + crop.width > imageSize.width) crop.width = imageSize.width - crop.x;
    if (crop.y + crop.height > imageSize.height) crop.height = imageSize.height - crop.y;
    if (crop.width <= 0 || crop.height <= 0) return null;
    return encodeCapture(capture.image.crop(crop));
  }

  async executeAgentAction(
    workspaceId: string,
    action: NativeBrowserAgentAction,
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.requireNative();
    this.state.ensureWorkspace(workspaceId);
    const control = new AbortController();
    const forwardAbort = (): void => control.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    let controls = this.agentControls.get(workspaceId);
    if (!controls) {
      controls = new Set();
      this.agentControls.set(workspaceId, controls);
    }
    controls.add(control);
    this.agentControlState.set(workspaceId, {
      action: action.kind,
      startedAtMs: Date.now(),
    });
    this.publish(workspaceId);
    try {
      return await abortable(
        this.executeAgentActionUnchecked(workspaceId, action),
        control.signal,
        () => this.stopWorkspaceLoads(workspaceId),
      );
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      controls.delete(control);
      if (controls.size === 0) {
        this.agentControls.delete(workspaceId);
        this.agentControlState.delete(workspaceId);
      }
      this.publish(workspaceId);
    }
  }

  async stopAgentControl(args: { workspaceId: string }): Promise<void> {
    const controls = this.agentControls.get(args.workspaceId);
    if (!controls) return;
    for (const control of controls) {
      control.abort(
        new BrowserOperationError({
          code: 'USER_ABORTED',
          message: 'The user stopped browser control.',
          nextAction: 'stop',
          retryable: false,
        }),
      );
    }
  }

  async resolvePermission(args: {
    workspaceId: string;
    requestId: string;
    allow: boolean;
  }): Promise<void> {
    const pending = this.pendingPermissions.get(args.requestId);
    if (!pending || pending.workspaceId !== args.workspaceId) {
      throw new Error('browser permission request is no longer active');
    }
    this.pendingPermissions.delete(args.requestId);
    if (args.allow) {
      this.permissionGrants.add(permissionGrantKey(pending.request.origin, pending.request.permission));
    }
    pending.callback(args.allow);
    this.publish(args.workspaceId);
  }

  async cancelDownload(args: { workspaceId: string; downloadId: string }): Promise<void> {
    const download = this.downloads.get(args.downloadId);
    if (!download || download.workspaceId !== args.workspaceId) {
      throw new Error('browser download is no longer active');
    }
    if (download.snapshot.state === 'progressing') download.item.cancel();
  }

  private async executeAgentActionUnchecked(
    workspaceId: string,
    action: NativeBrowserAgentAction,
  ): Promise<unknown> {
    switch (action.kind) {
      case 'tabs':
        return this.snapshot(workspaceId);
      case 'new_tab':
        return this.newTab({ workspaceId, ...(action.url ? { url: action.url } : {}) });
      case 'select_tab': {
        const target = this.captureTarget(workspaceId, action.tabId);
        return this.selectTab({ workspaceId, tabId: target.id });
      }
      case 'close_tab': {
        const target = this.captureTarget(workspaceId, action.tabId);
        return this.closeTab({ workspaceId, tabId: target.id });
      }
      case 'goto': {
        const target = this.captureTarget(workspaceId, action.tabId);
        await assertPublicUrl(action.url, 'native_browser_agent', { failClosed: true });
        const view = this.mustView(workspaceId, target);
        this.state.updateTab(workspaceId, target.id, { url: action.url, loading: true });
        this.publish(workspaceId);
        await this.withAgentOperation(view, () =>
          this.loadUrl(
            view,
            action.url,
            action.waitUntil ?? 'domcontentloaded',
            action.timeoutMs ?? 30_000,
          ),
        );
        return { url: view.webContents.getURL() || action.url, tabId: target.id };
      }
      case 'click': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        await this.withAgentOperation(view, async () => {
          const point = (await this.resolveBrowserTarget(view, action.target)).point;
          await this.dispatchMouseClick(
            view,
            point,
            action.button ?? 'left',
            action.count ?? 1,
          );
        });
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'observe': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const parsed = parseBrowserObservation(
          await this.executeScript(
            view,
            buildBrowserObservationScript(
              action.maxNodes ?? 120,
              action.maxTextChars ?? 6_000,
            ),
          ),
        );
        const accessibility =
          action.mode === 'visual'
            ? { nodes: [], targets: [] }
            : await this.collectAccessibilityObservation(
                view,
                Math.max(0, (action.maxNodes ?? 120) - parsed.observation.nodes.length),
                parsed.observation.nodes.length + 1,
              );
        const merged = mergeObservationNodes(
          parsed.observation.nodes,
          parsed.targets,
          accessibility.nodes,
          accessibility.targets,
        );
        this.rememberObservation(view, parsed.observation.revision, merged.targets);
        const nodes = action.mode === 'visual' ? [] : merged.nodes;
        if (action.mode === 'visual' || action.mode === 'hybrid') {
          const image = await this.withAgentOperation(view, () => view.webContents.capturePage());
          return {
            ...parsed.observation,
            nodes,
            tabId: target.id,
            ...encodeCapture(image),
            forModel: formatBrowserObservationForModel({
              ...parsed.observation,
              nodes,
            }),
          };
        }
        return {
          ...parsed.observation,
          nodes,
          tabId: target.id,
          forModel: formatBrowserObservationForModel({ ...parsed.observation, nodes }),
        };
      }
      case 'hover': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const resolved = await this.resolveBrowserTarget(view, action.target);
        await this.withSyntheticInput(view, () =>
          this.withDebugger(view, (debuggerSession) =>
            debuggerSession.sendCommand('Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              x: resolved.point.x,
              y: resolved.point.y,
            }),
          ),
        );
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'type': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const element = await this.resolveBrowserElementTarget(view, action.target);
        const value = action.value;
        if (value === undefined) throw new Error('INVALID_ACTION: text value required');
        await this.withAgentOperation(view, async () => {
          if (element.selector) {
            await view.webContents.executeJavaScript(
              prepareFillTargetScript(element.selector, action.timeoutMs ?? 10_000),
              true,
            );
          } else {
            await this.focusBackendNode(view, element);
            if (action.replace !== false) await this.selectFocusedText(view);
          }
          if (action.replace === false) {
            await this.withSyntheticInput(view, () =>
              this.withDebugger(view, (debuggerSession) =>
                debuggerSession.sendCommand('Input.dispatchKeyEvent', {
                  type: 'keyDown',
                  key: 'End',
                }),
              ),
            );
          }
          await this.withSyntheticInput(view, () =>
            this.withDebugger(view, (debuggerSession) =>
              debuggerSession.sendCommand('Input.insertText', { text: value }),
            ),
          );
        });
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'press': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        if (action.target) {
          const element = await this.resolveBrowserElementTarget(view, action.target);
          if (element.selector) await this.executeScript(view, focusTargetScript(element.selector));
          else await this.focusBackendNode(view, element);
        }
        const modifiers = cdpModifiers(action.modifiers);
        await this.withSyntheticInput(view, () =>
          this.withDebugger(view, async (debuggerSession) => {
            await debuggerSession.sendCommand('Input.dispatchKeyEvent', {
              type: 'keyDown',
              key: action.key,
              modifiers,
            });
            await debuggerSession.sendCommand('Input.dispatchKeyEvent', {
              type: 'keyUp',
              key: action.key,
              modifiers,
            });
          }),
        );
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'scroll': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const bounds = view.getBounds();
        const point = action.at
          ? normalizedPoint(action.at, bounds.width, bounds.height)
          : { x: bounds.width / 2, y: bounds.height / 2 };
        await this.withSyntheticInput(view, () =>
          this.withDebugger(view, (debuggerSession) =>
            debuggerSession.sendCommand('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: point.x,
              y: point.y,
              deltaX: action.deltaX ?? 0,
              deltaY: action.deltaY ?? 0,
            }),
          ),
        );
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'drag': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const start = await this.resolveBrowserTarget(view, action.from);
        const end = await this.resolveBrowserTarget(view, action.to);
        const steps = action.steps ?? 12;
        await this.withSyntheticInput(view, () => this.withDebugger(view, async (debuggerSession) => {
          await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: start.point.x,
            y: start.point.y,
          });
          await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: start.point.x,
            y: start.point.y,
            button: 'left',
            clickCount: 1,
          });
          for (let step = 1; step <= steps; step += 1) {
            const progress = step / steps;
            await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              x: start.point.x + (end.point.x - start.point.x) * progress,
              y: start.point.y + (end.point.y - start.point.y) * progress,
              button: 'left',
            });
          }
          await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: end.point.x,
            y: end.point.y,
            button: 'left',
            clickCount: 1,
          });
        }));
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'select': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const element = await this.resolveBrowserElementTarget(view, action.target);
        const selected = element.selector
          ? await this.executeScript(view, selectOptionsScript(element.selector, action.values))
          : await this.callFunctionOnElement(view, element, selectOptionsFunction(action.values));
        return {
          tabId: target.id,
          url: view.webContents.getURL() || BLANK_URL,
          selected,
        };
      }
      case 'upload': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const element = await this.resolveBrowserElementTarget(view, action.target);
        await validateUploadFiles(action.paths);
        await this.withDebugger(view, async (debuggerSession) => {
          const objectId = await resolveElementObjectId(debuggerSession, element);
          try {
            await debuggerSession.sendCommand('DOM.setFileInputFiles', {
              files: action.paths,
              objectId,
            });
            await debuggerSession.sendCommand('Runtime.callFunctionOn', {
              objectId,
              functionDeclaration:
                'function(){this.dispatchEvent(new Event("input",{bubbles:true}));' +
                'this.dispatchEvent(new Event("change",{bubbles:true}));}',
            });
          } finally {
            await debuggerSession
              .sendCommand('Runtime.releaseObject', { objectId })
              .catch(() => undefined);
          }
        });
        return {
          tabId: target.id,
          url: view.webContents.getURL() || BLANK_URL,
          files: action.paths.length,
        };
      }
      case 'wait': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const timeoutMs = action.timeoutMs ?? 30_000;
        if (action.condition.type === 'networkidle') {
          const idle = this.createNetworkIdleWaiter(view.webContents.id, NETWORK_IDLE_MS);
          try {
            idle.start();
            await withTimeout(idle.promise, timeoutMs, 'native browser network idle wait');
          } finally {
            idle.dispose();
          }
        } else {
          if (action.condition.type === 'target') {
            const element = await this.resolveBrowserElementTarget(
              view,
              action.condition.target,
            );
            if (element.backendDOMNodeId) {
              await this.waitForBackendTarget(
                view,
                element.backendDOMNodeId,
                action.condition.state,
                timeoutMs,
              );
            } else {
              await this.executeScript(
                view,
                waitConditionScript(action.condition, element.selector, timeoutMs),
              );
            }
          } else {
            await this.executeScript(
              view,
              waitConditionScript(action.condition, undefined, timeoutMs),
            );
          }
        }
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'text': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        if (!action.target) {
          return this.executeScript(view, 'document.body ? document.body.innerText : ""');
        }
        const element = await this.resolveBrowserElementTarget(view, action.target);
        return element.selector
          ? this.executeScript(view, elementTextScript(element.selector, 10_000))
          : this.callFunctionOnElement(
              view,
              element,
              'function(){return this.innerText || this.textContent || this.value || "";}',
            );
      }
      case 'html': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        return this.executeScript(
          view,
          buildSanitizedDocumentHtmlScript(),
        );
      }
      case 'screenshot': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        if (action.fullPage) {
          const capture = await this.withAgentOperation(view, () => this.captureFullPage(view));
          return { ...capture, tabId: target.id };
        }
        const image = await this.withAgentOperation(view, () => view.webContents.capturePage());
        return { ...encodeCapture(image), tabId: target.id };
      }
      case 'eval': {
        if (process.env.MOXXY_BROWSER_DISABLE_EVAL === '1') {
          throw new Error('browser_session eval is disabled (MOXXY_BROWSER_DISABLE_EVAL=1)');
        }
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        return this.executeScript(view, action.expression);
      }
      case 'url': {
        const target = this.captureTarget(workspaceId, action.tabId);
        return this.mustView(workspaceId, target).webContents.getURL() || BLANK_URL;
      }
      case 'back': {
        const target = this.captureTarget(workspaceId, action.tabId);
        await this.back({ workspaceId, tabId: target.id });
        return {
          tabId: target.id,
          url: this.mustView(workspaceId, target).webContents.getURL() || BLANK_URL,
        };
      }
      case 'forward': {
        const target = this.captureTarget(workspaceId, action.tabId);
        await this.forward({ workspaceId, tabId: target.id });
        return {
          tabId: target.id,
          url: this.mustView(workspaceId, target).webContents.getURL() || BLANK_URL,
        };
      }
      case 'reload': {
        const target = this.captureTarget(workspaceId, action.tabId);
        await this.reload({ workspaceId, tabId: target.id });
        return {
          tabId: target.id,
          url: this.mustView(workspaceId, target).webContents.getURL() || BLANK_URL,
        };
      }
    }
  }

  async destroy(): Promise<void> {
    this.destroying = true;
    this.detachAttachedView();
    for (const controls of this.agentControls.values()) {
      for (const control of controls) control.abort();
    }
    this.agentControls.clear();
    this.agentControlState.clear();
    for (const pending of this.pendingPermissions.values()) pending.callback(false);
    this.pendingPermissions.clear();
    for (const download of this.downloads.values()) {
      if (download.snapshot.state === 'progressing') download.item.cancel();
    }
    this.downloads.clear();
    this.reservedDownloadPaths.clear();
    await this.persist().catch(() => undefined);
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) {
        this.intentionalClosures.add(view);
        view.webContents.close();
      }
    }
    this.views.clear();
    this.pendingNetworkRequests.clear();
    this.networkActivityListeners.clear();
  }

  private installSessionSecurity(): void {
    const browserSession = this.options.browserSession;
    browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
      const sitePermission = mapSitePermission(permission, details.mediaType);
      if (!sitePermission) return false;
      const origin = publicOrigin(details.securityOrigin ?? requestingOrigin);
      if (!origin) return false;
      if (this.permissionGrants.has(permissionGrantKey(origin, sitePermission))) return true;
      return (
        (sitePermission === 'microphone' || sitePermission === 'camera') &&
        this.permissionGrants.has(permissionGrantKey(origin, 'microphone-camera'))
      );
    });
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const context = this.contextForWebContents(webContents);
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
      const sitePermission = mapRequestedSitePermission(permission, mediaTypes);
      const origin = publicOrigin(
        ('securityOrigin' in details ? details.securityOrigin : undefined) ?? details.requestingUrl,
      );
      if (!context || !sitePermission || !origin) {
        callback(false);
        return;
      }
      const request: NativeBrowserPermissionRequest = {
        id: randomUUID(),
        tabId: context.tabId,
        origin,
        permission: sitePermission,
      };
      this.pendingPermissions.set(request.id, {
        workspaceId: context.workspaceId,
        request,
        callback,
      });
      this.publish(context.workspaceId);
    });
    browserSession.on('will-download', (_event, item, webContents) => {
      this.registerDownload(item, webContents);
    });
    const requestFilter = { urls: ['http://*/*', 'https://*/*'] };
    browserSession.webRequest.onBeforeRequest(requestFilter, (details, callback) => {
      this.trackNetworkRequest(details.webContentsId, details.id);
      if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
        callback({ cancel: false });
        return;
      }
      void assertPublicUrl(details.url, 'native_browser_navigation', { failClosed: true })
        .then(() => callback({ cancel: false }))
        .catch(() => {
          this.finishNetworkRequest(details.webContentsId, details.id);
          callback({ cancel: true });
        });
    });
    browserSession.webRequest.onCompleted(requestFilter, (details) => {
      this.finishNetworkRequest(details.webContentsId, details.id);
    });
    browserSession.webRequest.onErrorOccurred(requestFilter, (details) => {
      this.finishNetworkRequest(details.webContentsId, details.id);
    });
  }

  private ensureView(workspaceId: string, tab: NativeBrowserTabSnapshot): WebContentsView {
    const key = viewKey(workspaceId, tab.id);
    const existing = this.views.get(key);
    if (existing && !existing.webContents.isDestroyed()) return existing;

    const view = this.createBrowserView();
    this.registerView(workspaceId, tab, view);
    if (tab.url !== BLANK_URL) void view.webContents.loadURL(tab.url).catch(() => undefined);
    return view;
  }

  private createBrowserView(webContents?: WebContents): WebContentsView {
    const custom = this.options.createView?.(webContents);
    if (custom) return custom;
    if (webContents) return new WebContentsView({ webContents });
    return new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
  }

  private registerView(
    workspaceId: string,
    tab: NativeBrowserTabSnapshot,
    view: WebContentsView,
  ): void {
    const key = viewKey(workspaceId, tab.id);
    const contents = view.webContents;
    // Detached tabs remain alive, but Chromium may throttle them until the tab
    // is visible or an agent operation explicitly leases it below.
    contents.setBackgroundThrottling(true);
    contents.setZoomFactor(tab.zoom);
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!isAllowedPopupUrl(url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            partition: BROWSER_PARTITION,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        },
        createWindow: (options) =>
          this.createPopupView(
            workspaceId,
            url,
            disposition,
            options as PopupWindowOptions,
          ),
      };
    });
    contents.on('context-menu', (_event, params) => {
      this.showContextMenu(workspaceId, tab.id, view, params);
    });
    contents.on('input-event', () => {
      if ((this.syntheticInputDepth.get(view) ?? 0) > 0) return;
      this.handleUserTakeover(workspaceId, view);
    });
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedDocumentUrl(url)) event.preventDefault();
    });
    contents.on('will-frame-navigate', (event) => {
      if (!isAllowedDocumentUrl(event.url)) event.preventDefault();
    });
    contents.on('did-start-loading', () => {
      this.updateFromContents(workspaceId, tab.id, { loading: true });
    });
    contents.on('did-stop-loading', () => {
      this.syncContentsState(workspaceId, tab.id, view);
    });
    contents.on('did-navigate', (_event, url) => {
      this.syncContentsState(workspaceId, tab.id, view, url);
    });
    contents.on('did-navigate-in-page', (_event, url) => {
      this.syncContentsState(workspaceId, tab.id, view, url);
    });
    contents.on('page-title-updated', (_event, title) => {
      this.updateFromContents(workspaceId, tab.id, { title: cleanTitle(title) });
    });
    contents.on('did-fail-load', () => {
      this.updateFromContents(workspaceId, tab.id, { loading: false });
    });
    contents.on('destroyed', () => {
      if (this.views.get(key) === view) this.views.delete(key);
      if (this.attachedKey === key) {
        this.attachedKey = null;
        this.attachedWindowId = null;
      }
      if (this.destroying || this.intentionalClosures.has(view)) return;
      this.removeClosedPopup(workspaceId, tab.id);
    });
    this.views.set(key, view);
  }

  private createPopupView(
    workspaceId: string,
    url: string,
    disposition: PopupDisposition,
    options: PopupWindowOptions,
  ): WebContents {
    const before = this.state.ensureWorkspace(workspaceId);
    const adoptedContents = options.webContents;
    let view: WebContentsView;
    try {
      view = this.createBrowserView(adoptedContents);
    } catch (error) {
      this.closeUnregisteredContents(adoptedContents);
      throw error;
    }
    if (adoptedContents && view.webContents !== adoptedContents) {
      this.closeUnregisteredView(view);
      this.closeUnregisteredContents(adoptedContents);
      throw new Error('popup view did not adopt Electron webContents');
    }

    let tab: NativeBrowserTabSnapshot | null = null;
    try {
      tab = this.state.newTab(workspaceId, url);
      if (disposition === 'background-tab') {
        this.state.selectTab(workspaceId, before.activeTabId);
      }
      this.registerView(workspaceId, tab, view);
      if (this.visibleWorkspaceId === workspaceId && disposition !== 'background-tab') {
        this.attachActiveView(workspaceId);
      }
      this.publish(workspaceId);
      void this.persist().catch(() => undefined);
      if (!adoptedContents) {
        queueMicrotask(() => {
          if (view.webContents.isDestroyed()) return;
          void view.webContents.loadURL(url).catch(() => this.rollbackPopup(workspaceId, tab?.id, view));
        });
      }
      return view.webContents;
    } catch (error) {
      this.rollbackPopup(workspaceId, tab?.id, view, before.activeTabId);
      throw error;
    }
  }

  private async openPopup(workspaceId: string, url: string): Promise<void> {
    await this.newTab({ workspaceId, url });
  }

  private removeClosedPopup(workspaceId: string, tabId: string): void {
    const snapshot = this.state.snapshot(workspaceId);
    if (!snapshot.tabs.some((tab) => tab.id === tabId)) return;
    if (this.capture?.workspaceId === workspaceId && this.capture.tabId === tabId) {
      this.capture = null;
    }
    this.state.closeTab(workspaceId, tabId);
    const active = this.state.resolveOperationTarget(workspaceId);
    this.ensureView(workspaceId, active);
    if (this.visibleWorkspaceId === workspaceId) this.attachActiveView(workspaceId);
    this.publish(workspaceId);
    void this.persist().catch(() => undefined);
  }

  private rollbackPopup(
    workspaceId: string,
    tabId: string | undefined,
    view: WebContentsView,
    activeTabId?: string,
  ): void {
    if (tabId) {
      const key = viewKey(workspaceId, tabId);
      if (this.views.get(key) === view) this.views.delete(key);
      const snapshot = this.state.snapshot(workspaceId);
      if (snapshot.tabs.some((candidate) => candidate.id === tabId)) {
        this.state.closeTab(workspaceId, tabId);
        if (activeTabId && this.state.snapshot(workspaceId).tabs.some((tab) => tab.id === activeTabId)) {
          this.state.selectTab(workspaceId, activeTabId);
        }
      }
    }
    this.closeUnregisteredView(view);
    if (this.visibleWorkspaceId === workspaceId) this.attachActiveView(workspaceId);
    this.publish(workspaceId);
    void this.persist().catch(() => undefined);
  }

  private closeUnregisteredView(view: WebContentsView): void {
    if (view.webContents.isDestroyed()) return;
    this.intentionalClosures.add(view);
    view.webContents.close();
  }

  private closeUnregisteredContents(contents: WebContents | undefined): void {
    if (!contents || contents.isDestroyed()) return;
    contents.close();
  }

  private showContextMenu(
    workspaceId: string,
    tabId: string,
    view: WebContentsView,
    params: ContextMenuParams,
  ): void {
    if (view.webContents.isDestroyed()) return;
    const template: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
    } else if (params.selectionText) {
      template.push({ role: 'copy' });
    }
    if (params.linkURL && isHttpUrl(params.linkURL)) {
      if (template.length > 0) template.push({ type: 'separator' });
      template.push({
        label: 'Open Link in New Tab',
        click: () => void this.openPopup(workspaceId, params.linkURL),
      });
    }
    if (template.length > 0) template.push({ type: 'separator' });
    template.push(
      {
        label: 'Back',
        enabled: view.webContents.navigationHistory.canGoBack(),
        click: () => void this.back({ workspaceId, tabId }),
      },
      {
        label: 'Forward',
        enabled: view.webContents.navigationHistory.canGoForward(),
        click: () => void this.forward({ workspaceId, tabId }),
      },
      { label: 'Reload', click: () => void this.reload({ workspaceId, tabId }) },
      { type: 'separator' },
      { role: 'selectAll' },
    );

    const menu = Menu.buildFromTemplate(template);
    const window = this.options.getMainWindow();
    if (window && !window.isDestroyed()) menu.popup({ window });
    else menu.popup();
  }

  private captureTarget(workspaceId: string, tabId?: string): NativeBrowserTabSnapshot {
    this.requireNative();
    this.state.ensureWorkspace(workspaceId);
    const target = this.state.resolveOperationTarget(workspaceId, tabId);
    this.ensureView(workspaceId, target);
    return target;
  }

  private mustView(workspaceId: string, tab: NativeBrowserTabSnapshot): WebContentsView {
    const view = this.ensureView(workspaceId, tab);
    if (view.webContents.isDestroyed()) throw new Error('native browser tab is closed');
    return view;
  }

  private attachActiveView(workspaceId: string): void {
    const bounds = this.bounds.get(workspaceId);
    if (!bounds || this.capture) return;
    const snapshot = this.snapshot(workspaceId);
    const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
    if (!active) throw new Error('native browser active tab missing');
    const view = this.mustView(workspaceId, active);
    const window = this.mustWindow();
    const key = viewKey(workspaceId, active.id);
    if (this.attachedKey !== key || this.attachedWindowId !== window.id) {
      this.detachAttachedView();
      window.contentView.addChildView(view);
      this.attachedKey = key;
      this.attachedWindowId = window.id;
    }
    view.setBounds(bounds);
    view.setVisible(true);
    view.webContents.setBackgroundThrottling(false);
  }

  private detachAttachedView(): void {
    const key = this.attachedKey;
    this.attachedKey = null;
    this.attachedWindowId = null;
    if (!key) return;
    const view = this.views.get(key);
    if (!view) return;
    view.setVisible(false);
    if ((this.activeAgentOperations.get(view) ?? 0) === 0 && !view.webContents.isDestroyed()) {
      view.webContents.setBackgroundThrottling(true);
    }
    const window = this.options.getMainWindow();
    if (!window || window.isDestroyed()) return;
    window.contentView.removeChildView(view);
  }

  private syncContentsState(
    workspaceId: string,
    tabId: string,
    view: WebContentsView,
    navigatedUrl?: string,
  ): void {
    if (view.webContents.isDestroyed()) return;
    const currentUrl = navigatedUrl ?? (view.webContents.getURL() || BLANK_URL);
    const patch: Partial<Omit<NativeBrowserTabSnapshot, 'id'>> = {
      loading: view.webContents.isLoading(),
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
      zoom: view.webContents.getZoomFactor(),
      ...(isAllowedDocumentUrl(currentUrl) ? { url: currentUrl } : {}),
    };
    this.updateFromContents(workspaceId, tabId, patch);
  }

  private updateFromContents(
    workspaceId: string,
    tabId: string,
    patch: Partial<Omit<NativeBrowserTabSnapshot, 'id'>>,
  ): void {
    try {
      this.state.updateTab(workspaceId, tabId, patch);
      this.publish(workspaceId);
      void this.persist().catch(() => undefined);
    } catch {
      // Late WebContents events may arrive after a tab/workspace was closed.
    }
  }

  private publish(workspaceId: string): void {
    this.options.onChanged(workspaceId, this.snapshot(workspaceId));
  }

  private snapshot(workspaceId: string): NativeBrowserSnapshot {
    const snapshot = this.state.snapshot(workspaceId);
    const agentControl = this.agentControlState.get(workspaceId);
    const permissionRequest = [...this.pendingPermissions.values()].find(
      (pending) => pending.workspaceId === workspaceId,
    )?.request;
    const downloads = [...this.downloads.values()]
      .filter((download) => download.workspaceId === workspaceId)
      .map((download) => download.snapshot);
    return {
      ...snapshot,
      ...(agentControl ? { agentControl } : {}),
      ...(permissionRequest ? { permissionRequest } : {}),
      ...(downloads.length > 0 ? { downloads } : {}),
    };
  }

  private contextForWebContents(webContents: WebContents):
    | { readonly workspaceId: string; readonly tabId: string }
    | null {
    for (const [key, view] of this.views) {
      if (view.webContents.id !== webContents.id) continue;
      const separator = key.indexOf('\u0000');
      if (separator < 1) return null;
      return { workspaceId: key.slice(0, separator), tabId: key.slice(separator + 1) };
    }
    return null;
  }

  private registerDownload(item: DownloadItem, webContents: WebContents): void {
    const context = this.contextForWebContents(webContents);
    if (!context) {
      item.cancel();
      return;
    }
    const id = randomUUID();
    const filename = safeDownloadFilename(item.getFilename());
    const savePath = this.availableDownloadPath(filename);
    item.setSavePath(savePath);
    const active: ActiveDownload = {
      workspaceId: context.workspaceId,
      item,
      snapshot: downloadSnapshot(id, context.tabId, filename, savePath, item, 'progressing'),
    };
    this.downloads.set(id, active);
    this.publish(context.workspaceId);
    item.on('updated', (_event, state) => {
      active.snapshot = downloadSnapshot(id, context.tabId, filename, savePath, item, state);
      this.publish(context.workspaceId);
    });
    item.once('done', (_event, state) => {
      active.snapshot = downloadSnapshot(id, context.tabId, filename, savePath, item, state);
      this.reservedDownloadPaths.delete(savePath);
      this.publish(context.workspaceId);
    });
  }

  private availableDownloadPath(filename: string): string {
    const extension = path.extname(filename);
    const stem = path.basename(filename, extension);
    for (let index = 0; index < 10_000; index += 1) {
      const candidateName = index === 0 ? filename : `${stem} (${index})${extension}`;
      const candidate = path.join(this.options.downloadsDir, candidateName);
      if (existsSync(candidate) || this.reservedDownloadPaths.has(candidate)) continue;
      this.reservedDownloadPaths.add(candidate);
      return candidate;
    }
    throw new Error('unable to allocate a safe browser download path');
  }

  private stopWorkspaceLoads(workspaceId: string): void {
    const prefix = `${workspaceId}\u0000`;
    for (const [key, view] of this.views) {
      if (!key.startsWith(prefix) || view.webContents.isDestroyed()) continue;
      view.webContents.stop();
    }
  }

  private handleUserTakeover(workspaceId: string, view: WebContentsView): void {
    this.observations.delete(view);
    const controls = this.agentControls.get(workspaceId);
    if (!controls) return;
    const reason = new BrowserOperationError({
      code: 'USER_TAKEOVER',
      message: 'The user interacted with the shared browser page.',
      nextAction: 'observe',
      retryable: true,
    });
    for (const control of controls) control.abort(reason);
  }

  private persist(): Promise<void> {
    return this.store.save(this.state.serialize());
  }

  private async withAgentOperation<T>(view: WebContentsView, operation: () => Promise<T>): Promise<T> {
    if (view.webContents.isDestroyed()) throw new Error('native browser tab is closed');
    const active = (this.activeAgentOperations.get(view) ?? 0) + 1;
    this.activeAgentOperations.set(view, active);
    view.webContents.setBackgroundThrottling(false);
    try {
      return await operation();
    } finally {
      const remaining = Math.max(0, (this.activeAgentOperations.get(view) ?? 1) - 1);
      if (remaining === 0) this.activeAgentOperations.delete(view);
      else this.activeAgentOperations.set(view, remaining);
      if (remaining === 0 && !this.isAttached(view) && !view.webContents.isDestroyed()) {
        view.webContents.setBackgroundThrottling(true);
      }
    }
  }

  private isAttached(view: WebContentsView): boolean {
    const key = this.attachedKey;
    return Boolean(key && this.views.get(key) === view);
  }

  private executeScript(view: WebContentsView, script: string): Promise<unknown> {
    return this.withAgentOperation(view, () => view.webContents.executeJavaScript(script, true));
  }

  private rememberObservation(
    view: WebContentsView,
    revision: string,
    targets: ReadonlyMap<string, BrowserObservationTarget>,
  ): void {
    let observations = this.observations.get(view);
    if (!observations) {
      observations = new Map();
      this.observations.set(view, observations);
    }
    observations.set(revision, targets);
    while (observations.size > 3) {
      const oldest = observations.keys().next().value as string | undefined;
      if (!oldest) break;
      observations.delete(oldest);
    }
  }

  private collectAccessibilityObservation(
    view: WebContentsView,
    maxNodes: number,
    startRef: number,
  ): Promise<ReturnType<typeof buildAccessibilityObservationNodes>> {
    if (maxNodes <= 0) return Promise.resolve({ nodes: [], targets: [] });
    return this.withDebugger(view, async (debuggerSession) => {
      const frameTree = await debuggerSession.sendCommand('Page.getFrameTree');
      const frameIds = extractFrameIds(frameTree).slice(0, 32);
      if (frameIds.length === 0) return { nodes: [], targets: [] };
      const trees: Array<{ frameId: string; nodes: ReadonlyArray<unknown> }> = [];
      const bounds = new Map<
        string,
        { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
      >();
      const describedBackendNodes = new Set<number>();
      for (const frameId of frameIds) {
        const response = await debuggerSession.sendCommand('Accessibility.getFullAXTree', {
          frameId,
        });
        const nodes = extractAccessibilityNodes(response);
        trees.push({ frameId, nodes });
        for (const candidate of nodes) {
          const backendDOMNodeId = extractBackendDOMNodeId(candidate);
          if (!backendDOMNodeId || describedBackendNodes.has(backendDOMNodeId)) continue;
          describedBackendNodes.add(backendDOMNodeId);
          try {
            const model = await debuggerSession.sendCommand('DOM.getBoxModel', {
              backendNodeId: backendDOMNodeId,
            });
            const nodeBounds = extractBoxModelBounds(model);
            if (nodeBounds) bounds.set(`${frameId}:${backendDOMNodeId}`, nodeBounds);
          } catch {
            // Detached or non-rendered accessibility nodes are intentionally skipped.
          }
        }
      }
      return buildAccessibilityObservationNodes(trees, bounds, maxNodes, startRef);
    });
  }

  private async resolveBrowserTarget(
    view: WebContentsView,
    target: BrowserTarget,
  ): Promise<{ readonly point: { readonly x: number; readonly y: number }; readonly selector?: string }> {
    if (target.type === 'point') {
      const bounds = view.getBounds();
      return { point: normalizedPoint(target, bounds.width, bounds.height) };
    }
    if (target.type === 'selector') {
      return {
        selector: target.selector,
        point: parseInteractionPoint(
          await this.executeScript(view, buildBrowserSelectorPointScript(target.selector)),
          'ELEMENT_NOT_FOUND',
        ),
      };
    }
    const observation = this.observations.get(view)?.get(target.revision);
    const stored = observation?.get(target.ref);
    if (!stored) throw new Error('STALE_BROWSER_STATE: observe the page again');
    if (stored.backendDOMNodeId) {
      const current = await this.executeScript(
        view,
        buildBrowserRefValidationScript(target.revision),
      );
      if (current !== true) throw new Error('STALE_BROWSER_STATE: observe the page again');
      const model = await this.withDebugger(view, (debuggerSession) =>
        debuggerSession.sendCommand('DOM.getBoxModel', {
          backendNodeId: stored.backendDOMNodeId,
        }),
      );
      const bounds = extractBoxModelBounds(model);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        throw new Error('STALE_BROWSER_STATE: accessibility target is no longer visible');
      }
      return {
        point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      };
    }
    if (!stored.selector) {
      throw new Error('ELEMENT_NOT_INTERACTABLE: target cannot be resolved');
    }
    return {
      selector: stored.selector,
      point: parseInteractionPoint(
        await this.executeScript(view, buildBrowserRefPointScript(stored, target.revision)),
        'STALE_BROWSER_STATE',
      ),
    };
  }

  private async selectorForBrowserTarget(
    view: WebContentsView,
    target: Exclude<BrowserTarget, { readonly type: 'point' }>,
  ): Promise<string> {
    const stored = await this.resolveBrowserElementTarget(view, target);
    if (!stored.selector) {
      throw new Error('ELEMENT_NOT_INTERACTABLE: selector target required for this action');
    }
    return stored.selector;
  }

  private async resolveBrowserElementTarget(
    view: WebContentsView,
    target: Exclude<BrowserTarget, { readonly type: 'point' }>,
  ): Promise<BrowserObservationTarget> {
    if (target.type === 'selector') {
      return {
        selector: target.selector,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      };
    }
    const observations = this.observations.get(view);
    const revision = observations?.get(target.revision);
    const stored = revision?.get(target.ref);
    if (!stored) throw new Error('STALE_BROWSER_STATE: observe the page again');
    const current = await this.executeScript(
      view,
      buildBrowserRefValidationScript(target.revision),
    );
    if (current !== true) throw new Error('STALE_BROWSER_STATE: observe the page again');
    return stored;
  }

  private focusBackendNode(view: WebContentsView, target: BrowserObservationTarget): Promise<void> {
    if (!target.backendDOMNodeId) {
      return Promise.reject(new Error('ELEMENT_NOT_INTERACTABLE: focus target is unavailable'));
    }
    return this.withDebugger(view, async (debuggerSession) => {
      await debuggerSession.sendCommand('DOM.focus', {
        backendNodeId: target.backendDOMNodeId,
      });
    });
  }

  private selectFocusedText(view: WebContentsView): Promise<void> {
    const modifiers = process.platform === 'darwin' ? 4 : 2;
    return this.withSyntheticInput(view, () =>
      this.withDebugger(view, async (debuggerSession) => {
        await debuggerSession.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'a',
          modifiers,
        });
        await debuggerSession.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'a',
          modifiers,
        });
      }),
    );
  }

  private callFunctionOnElement(
    view: WebContentsView,
    target: BrowserObservationTarget,
    functionDeclaration: string,
  ): Promise<unknown> {
    return this.withDebugger(view, async (debuggerSession) => {
      const objectId = await resolveElementObjectId(debuggerSession, target);
      try {
        const response = await debuggerSession.sendCommand('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration,
          returnByValue: true,
        });
        return remoteResultValue(response);
      } finally {
        await debuggerSession
          .sendCommand('Runtime.releaseObject', { objectId })
          .catch(() => undefined);
      }
    });
  }

  private async waitForBackendTarget(
    view: WebContentsView,
    backendDOMNodeId: number,
    state: 'visible' | 'hidden',
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let visible = false;
      try {
        const model = await this.withDebugger(view, (debuggerSession) =>
          debuggerSession.sendCommand('DOM.getBoxModel', { backendNodeId: backendDOMNodeId }),
        );
        const bounds = extractBoxModelBounds(model);
        visible = Boolean(bounds && bounds.width > 0 && bounds.height > 0);
      } catch {
        visible = false;
      }
      if ((state === 'visible' && visible) || (state === 'hidden' && !visible)) return;
      if (Date.now() >= deadline) {
        throw new Error(`TIMEOUT: target did not become ${state}`);
      }
      await delay(50);
    }
  }

  private dispatchMouseClick(
    view: WebContentsView,
    point: { readonly x: number; readonly y: number },
    button: 'left' | 'middle' | 'right',
    clickCount: number,
  ): Promise<void> {
    return this.withSyntheticInput(view, () =>
      this.withDebugger(view, async (debuggerSession) => {
        const input = { x: point.x, y: point.y, button, clickCount };
        await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          ...input,
        });
        await debuggerSession.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          ...input,
        });
      }),
    );
  }

  private async withSyntheticInput<T>(
    view: WebContentsView,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.syntheticInputDepth.set(view, (this.syntheticInputDepth.get(view) ?? 0) + 1);
    try {
      return await operation();
    } finally {
      const remaining = Math.max(0, (this.syntheticInputDepth.get(view) ?? 1) - 1);
      if (remaining === 0) this.syntheticInputDepth.delete(view);
      else this.syntheticInputDepth.set(view, remaining);
    }
  }

  private async loadUrl(
    view: WebContentsView,
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle',
    timeoutMs: number,
  ): Promise<void> {
    const contents = view.webContents;
    if (waitUntil === 'networkidle') {
      const idle = this.createNetworkIdleWaiter(contents.id, NETWORK_IDLE_MS);
      try {
        await withTimeout(
          (async () => {
            await contents.loadURL(url);
            idle.start();
            await idle.promise;
          })(),
          timeoutMs,
          'native browser network-idle navigation',
        );
      } finally {
        idle.dispose();
      }
      return;
    }

    if (waitUntil === 'load') {
      const navigation = contents.loadURL(url);
      await withTimeout(navigation, timeoutMs, 'native browser load navigation');
      return;
    }
    const domReady = waitForWebContentsEvent(contents, 'dom-ready');
    try {
      const navigation = contents.loadURL(url);
      await withTimeout(
        Promise.race([navigation, domReady.promise]),
        timeoutMs,
        'native browser DOM navigation',
      );
    } finally {
      domReady.dispose();
    }
  }

  private captureFullPage(view: WebContentsView): Promise<NativeBrowserCapture> {
    return this.withDebugger(view, async (debuggerSession) => {
      const metrics = parseLayoutMetrics(
        await debuggerSession.sendCommand('Page.getLayoutMetrics'),
      );
      if (
        metrics.width > MAX_FULL_PAGE_DIMENSION ||
        metrics.height > MAX_FULL_PAGE_DIMENSION ||
        metrics.width * metrics.height > MAX_FULL_PAGE_PIXELS
      ) {
        throw new Error(
          `full-page screenshot exceeds the safe capture limit (${metrics.width}x${metrics.height})`,
        );
      }
      const captured = parseScreenshotResult(
        await debuggerSession.sendCommand('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: metrics.width, height: metrics.height, scale: 1 },
        }),
      );
      return { mediaType: 'image/png', base64: captured };
    });
  }

  private trackNetworkRequest(webContentsId: number | undefined, requestId: number): void {
    if (webContentsId === undefined) return;
    let pending = this.pendingNetworkRequests.get(webContentsId);
    if (!pending) {
      pending = new Set<number>();
      this.pendingNetworkRequests.set(webContentsId, pending);
    }
    pending.add(requestId);
    this.notifyNetworkActivity(webContentsId);
  }

  private finishNetworkRequest(webContentsId: number | undefined, requestId: number): void {
    if (webContentsId === undefined) return;
    const pending = this.pendingNetworkRequests.get(webContentsId);
    if (!pending || !pending.delete(requestId)) return;
    if (pending.size === 0) this.pendingNetworkRequests.delete(webContentsId);
    this.notifyNetworkActivity(webContentsId);
  }

  private notifyNetworkActivity(webContentsId: number): void {
    const listeners = this.networkActivityListeners.get(webContentsId);
    if (!listeners) return;
    for (const listener of listeners) listener();
  }

  private createNetworkIdleWaiter(webContentsId: number, idleMs: number): {
    readonly promise: Promise<void>;
    start: () => void;
    dispose: () => void;
  } {
    let started = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let resolveIdle: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolveIdle = resolve;
    });
    const cancel = (): void => {
      if (!idleTimer) return;
      clearTimeout(idleTimer);
      idleTimer = null;
    };
    const update = (): void => {
      cancel();
      if (!started || (this.pendingNetworkRequests.get(webContentsId)?.size ?? 0) > 0) return;
      idleTimer = setTimeout(resolveIdle, idleMs);
      idleTimer.unref?.();
    };
    let listeners = this.networkActivityListeners.get(webContentsId);
    if (!listeners) {
      listeners = new Set<() => void>();
      this.networkActivityListeners.set(webContentsId, listeners);
    }
    listeners.add(update);
    return {
      promise,
      start: () => {
        started = true;
        update();
      },
      dispose: () => {
        cancel();
        listeners.delete(update);
        if (listeners.size === 0) this.networkActivityListeners.delete(webContentsId);
      },
    };
  }

  private async withDebugger<T>(
    view: WebContentsView,
    operation: (debuggerSession: Debugger) => Promise<T>,
  ): Promise<T> {
    const previous = this.debuggerQueues.get(view) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const debuggerSession = view.webContents.debugger;
      const owned = !debuggerSession.isAttached();
      if (owned) debuggerSession.attach(DEVTOOLS_PROTOCOL_VERSION);
      try {
        return await operation(debuggerSession);
      } finally {
        if (owned && debuggerSession.isAttached()) debuggerSession.detach();
      }
    });
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.debuggerQueues.set(view, tail);
    try {
      return await run;
    } finally {
      if (this.debuggerQueues.get(view) === tail) this.debuggerQueues.delete(view);
    }
  }

  private requireNative(): void {
    if (this.backend.backend !== 'native' || !this.backend.available) {
      throw new Error(this.backend.reason ?? 'native browser is unavailable');
    }
  }

  private mustWindow(): BrowserWindow {
    const window = this.options.getMainWindow();
    if (!window || window.isDestroyed()) throw new Error('main window is unavailable');
    return window;
  }
}

function viewKey(workspaceId: string, tabId: string): string {
  return `${workspaceId}\u0000${tabId}`;
}

function mergeObservationNodes(
  primaryNodes: ReadonlyArray<BrowserObservationNode>,
  primaryTargets: ReadonlyMap<string, BrowserObservationTarget>,
  accessibilityNodes: ReadonlyArray<BrowserObservationNode>,
  accessibilityTargets: ReadonlyArray<BrowserObservationTarget>,
): {
  readonly nodes: ReadonlyArray<BrowserObservationNode>;
  readonly targets: ReadonlyMap<string, BrowserObservationTarget>;
} {
  const nodes = [...primaryNodes];
  const targets = new Map(primaryTargets);
  accessibilityNodes.forEach((node, index) => {
    const duplicate = nodes.some(
      (existing) =>
        existing.role === node.role &&
        existing.name === node.name &&
        approximatelyEqualBounds(existing.bounds, node.bounds),
    );
    if (duplicate) return;
    const target = accessibilityTargets[index];
    if (!target) return;
    nodes.push(node);
    targets.set(node.ref, target);
  });
  return { nodes, targets };
}

function approximatelyEqualBounds(
  left: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  right: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  return (
    Math.abs(left.x - right.x) < 2 &&
    Math.abs(left.y - right.y) < 2 &&
    Math.abs(left.width - right.width) < 2 &&
    Math.abs(left.height - right.height) < 2
  );
}

function extractFrameIds(value: unknown): string[] {
  const root = objectValue(value, 'frameTree');
  const result: string[] = [];
  const visit = (candidate: unknown): void => {
    const frame = objectValue(candidate, 'frame');
    const id = stringValue(frame, 'id');
    if (id) result.push(id);
    const children = arrayValue(candidate, 'childFrames');
    for (const child of children) visit(child);
  };
  if (root) visit(root);
  return result;
}

function extractAccessibilityNodes(value: unknown): ReadonlyArray<unknown> {
  return arrayValue(value, 'nodes');
}

function extractBackendDOMNodeId(value: unknown): number | undefined {
  const record = objectRecord(value);
  const candidate = record?.backendDOMNodeId;
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0
    ? candidate
    : undefined;
}

function extractBoxModelBounds(
  value: unknown,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined {
  const model = objectValue(value, 'model');
  const border = arrayValue(model, 'border').filter(
    (candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate),
  );
  if (border.length !== 8) return undefined;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < border.length; index += 2) {
    const x = border[index];
    const y = border[index + 1];
    if (x === undefined || y === undefined) return undefined;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function objectValue(value: unknown, key: string): Record<string, unknown> | undefined {
  return objectRecord(objectRecord(value)?.[key]);
}

function arrayValue(value: unknown, key: string): ReadonlyArray<unknown> {
  const candidate = objectRecord(value)?.[key];
  return Array.isArray(candidate) ? candidate : [];
}

function stringValue(value: unknown, key: string): string | undefined {
  const candidate = objectRecord(value)?.[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function encodeCapture(image: NativeImage): NativeBrowserCapture {
  return { mediaType: 'image/png', base64: image.toPNG().toString('base64') };
}

function isHttpUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isAllowedDocumentUrl(raw: string): boolean {
  return raw === BLANK_URL || isHttpUrl(raw);
}

function isAllowedPopupUrl(raw: string): boolean {
  return isAllowedDocumentUrl(raw);
}

function cleanTitle(title: string): string {
  const value = title.trim();
  return value ? value.slice(0, 512) : 'New tab';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elementTextScript(selector: string, timeoutMs: number): string {
  const selectorJson = JSON.stringify(selector);
  const actionScript = 'return element.textContent || "";';
  return `(() => new Promise((resolve, reject) => {
    const selector = ${selectorJson};
    const deadline = Date.now() + ${timeoutMs};
    const find = () => {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        try { resolve((() => { ${actionScript} })()); } catch (error) { reject(error); }
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for selector: ' + selector));
        return;
      }
      setTimeout(find, 50);
    };
    find();
  }))()`;
}

function prepareFillTargetScript(selector: string, timeoutMs: number): string {
  const selectorJson = JSON.stringify(selector);
  return `(() => new Promise((resolve, reject) => {
    const selector = ${selectorJson};
    const deadline = Date.now() + ${timeoutMs};
    const find = () => {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        try {
          element.scrollIntoView({ block: 'center', inline: 'center' });
          element.focus();
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            if (element.disabled || element.readOnly) throw new Error('Target is not editable: ' + selector);
            element.select();
          } else if (element.isContentEditable) {
            const selection = window.getSelection();
            if (!selection) throw new Error('Text selection is unavailable');
            const range = document.createRange();
            range.selectNodeContents(element);
            selection.removeAllRanges();
            selection.addRange(range);
          } else {
            throw new Error('Target is not fillable: ' + selector);
          }
          resolve({ fillable: true });
        } catch (error) { reject(error); }
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for selector: ' + selector));
        return;
      }
      setTimeout(find, 50);
    };
    find();
  }))()`;
}

function focusTargetScript(selector: string): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error('ELEMENT_NOT_FOUND: focus target is unavailable');
    }
    element.focus();
    return { focused: document.activeElement === element };
  })()`;
}

function selectOptionsScript(selector: string, values: ReadonlyArray<string>): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error('ELEMENT_NOT_INTERACTABLE: target is not a select');
    }
    const requested = new Set(${JSON.stringify(values)});
    const selected = [];
    for (const option of element.options) {
      option.selected = requested.has(option.value) || requested.has(option.label);
      if (option.selected) selected.push(option.value);
    }
    if (selected.length === 0) {
      throw new Error('SELECT_OPTION_NOT_FOUND: no requested option exists');
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return selected;
  })()`;
}

function selectOptionsFunction(values: ReadonlyArray<string>): string {
  return `function(){
    if (!(this instanceof HTMLSelectElement)) {
      throw new Error('ELEMENT_NOT_INTERACTABLE: target is not a select');
    }
    const requested = new Set(${JSON.stringify(values)});
    const selected = [];
    for (const option of this.options) {
      option.selected = requested.has(option.value) || requested.has(option.label);
      if (option.selected) selected.push(option.value);
    }
    if (selected.length === 0) {
      throw new Error('ELEMENT_NOT_FOUND: no requested option exists');
    }
    this.dispatchEvent(new Event('input', { bubbles: true }));
    this.dispatchEvent(new Event('change', { bubbles: true }));
    return selected;
  }`;
}

function waitConditionScript(
  condition:
    | {
        readonly type: 'target';
        readonly state: 'visible' | 'hidden';
      }
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'url'; readonly includes: string },
  selector: string | undefined,
  timeoutMs: number,
): string {
  const conditionJson = JSON.stringify(condition);
  const selectorJson = JSON.stringify(selector ?? null);
  return `(() => new Promise((resolve, reject) => {
    const condition = ${conditionJson};
    const selector = ${selectorJson};
    const deadline = Date.now() + ${timeoutMs};
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const matches = () => {
      if (condition.type === 'target') {
        const found = selector ? document.querySelector(selector) : null;
        return condition.state === 'visible' ? visible(found) : !visible(found);
      }
      if (condition.type === 'text') {
        return Boolean(document.body?.innerText.includes(condition.text));
      }
      return location.href.includes(condition.includes);
    };
    const check = () => {
      if (matches()) {
        resolve({ matched: true });
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for browser condition'));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  }))()`;
}

async function validateUploadFiles(paths: ReadonlyArray<string>): Promise<void> {
  for (const candidate of paths) {
    if (!path.isAbsolute(candidate)) {
      throw new Error(`browser upload path must be absolute: ${JSON.stringify(candidate)}`);
    }
    const stats = await lstat(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`browser upload path must be a regular file: ${JSON.stringify(candidate)}`);
    }
  }
}

function parseRemoteObjectId(value: unknown): string {
  if (!value || typeof value !== 'object') {
    throw new Error('ELEMENT_NOT_FOUND: file input is unavailable');
  }
  const envelope = value as { result?: unknown; object?: unknown };
  const result = envelope.result ?? envelope.object;
  if (!result || typeof result !== 'object') {
    throw new Error('ELEMENT_NOT_FOUND: file input is unavailable');
  }
  const objectId = (result as { objectId?: unknown }).objectId;
  if (typeof objectId !== 'string' || objectId.length === 0) {
    throw new Error('ELEMENT_NOT_FOUND: file input is unavailable');
  }
  return objectId;
}

async function resolveElementObjectId(
  debuggerSession: Debugger,
  target: BrowserObservationTarget,
): Promise<string> {
  if (target.backendDOMNodeId) {
    return parseRemoteObjectId(
      await debuggerSession.sendCommand('DOM.resolveNode', {
        backendNodeId: target.backendDOMNodeId,
      }),
    );
  }
  if (!target.selector) {
    throw new Error('ELEMENT_NOT_INTERACTABLE: element target is unavailable');
  }
  return parseRemoteObjectId(
    await debuggerSession.sendCommand('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(target.selector)})`,
      returnByValue: false,
    }),
  );
}

function remoteResultValue(value: unknown): unknown {
  const result = objectValue(value, 'result');
  return result?.value;
}

function parseInteractionPoint(
  value: unknown,
  errorCode = 'native browser click target',
): { x: number; y: number } {
  if (!value || typeof value !== 'object') throw new Error(`${errorCode}: target is invalid`);
  const point = value as { x?: unknown; y?: unknown; stale?: unknown };
  if (point.stale === true) throw new Error(`${errorCode}: observe the page again`);
  if (
    typeof point.x !== 'number' ||
    !Number.isFinite(point.x) ||
    typeof point.y !== 'number' ||
    !Number.isFinite(point.y)
  ) {
    throw new Error(`${errorCode}: target has invalid coordinates`);
  }
  return { x: point.x, y: point.y };
}

function normalizedPoint(
  point: { readonly x: number; readonly y: number },
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  return {
    x: (point.x / 1_000) * Math.max(1, width),
    y: (point.y / 1_000) * Math.max(1, height),
  };
}

function cdpModifiers(
  modifiers: ReadonlyArray<'alt' | 'control' | 'meta' | 'shift'> | undefined,
): number {
  return (modifiers ?? []).reduce((mask, modifier) => {
    if (modifier === 'alt') return mask | 1;
    if (modifier === 'control') return mask | 2;
    if (modifier === 'meta') return mask | 4;
    return mask | 8;
  }, 0);
}

function parseLayoutMetrics(value: unknown): { width: number; height: number } {
  if (!value || typeof value !== 'object') throw new Error('native browser layout metrics are missing');
  const result = value as { cssContentSize?: unknown };
  if (!result.cssContentSize || typeof result.cssContentSize !== 'object') {
    throw new Error('native browser CSS content metrics are missing');
  }
  const size = result.cssContentSize as { width?: unknown; height?: unknown };
  if (
    typeof size.width !== 'number' ||
    !Number.isFinite(size.width) ||
    size.width <= 0 ||
    typeof size.height !== 'number' ||
    !Number.isFinite(size.height) ||
    size.height <= 0
  ) {
    throw new Error('native browser CSS content metrics are invalid');
  }
  return { width: Math.ceil(size.width), height: Math.ceil(size.height) };
}

function parseScreenshotResult(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('native browser screenshot is missing');
  const result = value as { data?: unknown };
  if (typeof result.data !== 'string' || result.data.length === 0) {
    throw new Error('native browser screenshot data is invalid');
  }
  return result.data;
}

function waitForWebContentsEvent(contents: WebContents, event: 'dom-ready'): {
  readonly promise: Promise<void>;
  dispose: () => void;
} {
  let resolveEvent: () => void = () => undefined;
  const listener = (): void => resolveEvent();
  const promise = new Promise<void>((resolve) => {
    resolveEvent = resolve;
    contents.once(event, listener);
  });
  return {
    promise,
    dispose: () => contents.off(event, listener),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort: () => void,
): Promise<T> {
  if (signal.aborted) {
    onAbort();
    return Promise.reject(browserAbortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      onAbort();
      reject(browserAbortReason(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

function browserAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new BrowserOperationError({
        code: 'USER_ABORTED',
        message: 'The user stopped browser control.',
        nextAction: 'stop',
        retryable: false,
      });
}

function mapSitePermission(
  permission: string,
  mediaType: 'video' | 'audio' | 'unknown' | undefined,
): NativeBrowserSitePermission | null {
  if (permission === 'media') {
    if (mediaType === 'audio') return 'microphone';
    if (mediaType === 'video') return 'camera';
    return 'microphone-camera';
  }
  if (permission === 'geolocation') return 'geolocation';
  if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
    return 'clipboard';
  }
  return null;
}

function mapRequestedSitePermission(
  permission: string,
  mediaTypes: ReadonlyArray<'video' | 'audio'> | undefined,
): NativeBrowserSitePermission | null {
  if (permission !== 'media') return mapSitePermission(permission, undefined);
  const audio = mediaTypes?.includes('audio') ?? false;
  const video = mediaTypes?.includes('video') ?? false;
  if (audio && video) return 'microphone-camera';
  if (audio) return 'microphone';
  if (video) return 'camera';
  return null;
}

function permissionGrantKey(origin: string, permission: NativeBrowserSitePermission): string {
  return `${origin}\u0000${permission}`;
}

function publicOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function safeDownloadFilename(value: string): string {
  const basename = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!basename || basename === '.' || basename === '..') return 'download';
  return basename.slice(0, 240);
}

function downloadSnapshot(
  id: string,
  tabId: string,
  filename: string,
  savePath: string,
  item: DownloadItem,
  state: NativeBrowserDownload['state'],
): NativeBrowserDownload {
  return {
    id,
    tabId,
    filename,
    state,
    receivedBytes: Math.max(0, item.getReceivedBytes()),
    totalBytes: Math.max(0, item.getTotalBytes()),
    savePath,
  };
}
