import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  Menu,
  WebContentsView,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type NativeImage,
  type Session,
} from 'electron';
import {
  NativeBrowserState,
  NativeBrowserStateStore,
  projectNativeBrowserBounds,
  type NativeBrowserController,
  type NativeBrowserAgentAction,
} from '@moxxy/desktop-host/native-browser';
import type {
  NativeBrowserAvailability,
  NativeBrowserCapture,
  NativeBrowserRect,
  NativeBrowserSnapshot,
  NativeBrowserTabSnapshot,
  NativeBrowserViewport,
} from '@moxxy/desktop-ipc-contract';
import { assertPublicUrl } from '@moxxy/plugin-browser/ssrf-guard';

const BROWSER_PARTITION = 'persist:moxxy-browser-v1';
const BLANK_URL = 'about:blank';

interface NativeBrowserControllerOptions {
  readonly browserSession: Session;
  readonly userDataDir: string;
  readonly getMainWindow: () => BrowserWindow | null;
  readonly onChanged: (workspaceId: string, snapshot: NativeBrowserSnapshot) => void;
  readonly backendOverride?: string;
  readonly createView?: () => WebContentsView;
}

interface CaptureState {
  readonly workspaceId: string;
  readonly tabId: string;
  readonly image: NativeImage;
  readonly viewBounds: NativeBrowserRect;
}

/** Owns every third-party WebContents used by the Moxxy Browser. The app
 * renderer sees only snapshots and geometry IPC; it never receives a
 * WebContents handle or any Electron primitive. */
export class ElectronNativeBrowserController implements NativeBrowserController {
  private readonly state = new NativeBrowserState(randomUUID);
  private readonly store: NativeBrowserStateStore;
  private readonly views = new Map<string, WebContentsView>();
  private readonly activeAgentOperations = new WeakMap<WebContentsView, number>();
  private readonly bounds = new Map<string, NativeBrowserRect>();
  private backend: NativeBrowserAvailability = { backend: 'playwright', available: true };
  private visibleWorkspaceId: string | null = null;
  private attachedKey: string | null = null;
  private attachedWindowId: number | null = null;
  private capture: CaptureState | null = null;
  private started = false;

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
    return this.state.snapshot(args.workspaceId);
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
    return this.state.snapshot(args.workspaceId);
  }

  async selectTab(args: { workspaceId: string; tabId: string }): Promise<NativeBrowserSnapshot> {
    this.requireNative();
    this.state.selectTab(args.workspaceId, args.tabId);
    if (this.visibleWorkspaceId === args.workspaceId && !this.capture) {
      this.attachActiveView(args.workspaceId);
    }
    this.publish(args.workspaceId);
    await this.persist();
    return this.state.snapshot(args.workspaceId);
  }

  async closeTab(args: { workspaceId: string; tabId: string }): Promise<NativeBrowserSnapshot> {
    this.requireNative();
    const key = viewKey(args.workspaceId, args.tabId);
    if (this.attachedKey === key) this.detachAttachedView();
    const view = this.views.get(key);
    this.views.delete(key);
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    if (this.capture?.workspaceId === args.workspaceId && this.capture.tabId === args.tabId) {
      this.capture = null;
    }
    this.state.closeTab(args.workspaceId, args.tabId);
    const snapshot = this.state.snapshot(args.workspaceId);
    const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
    if (!active) throw new Error('native browser active tab missing after close');
    this.ensureView(args.workspaceId, active);
    if (this.visibleWorkspaceId === args.workspaceId) this.attachActiveView(args.workspaceId);
    this.publish(args.workspaceId);
    await this.persist();
    return this.state.snapshot(args.workspaceId);
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
  ): Promise<unknown> {
    this.requireNative();
    switch (action.kind) {
      case 'tabs':
        this.state.ensureWorkspace(workspaceId);
        return this.state.snapshot(workspaceId);
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
          withTimeout(
            view.webContents.loadURL(action.url),
            action.timeoutMs ?? 30_000,
            'native browser navigation',
          ),
        );
        return { url: view.webContents.getURL() || action.url, tabId: target.id };
      }
      case 'click': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        await this.executeScript(
          view,
          elementActionScript(action.selector, action.timeoutMs ?? 10_000, 'click'),
        );
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'fill': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        await this.executeScript(
          view,
          fillActionScript(action.selector, action.value, action.timeoutMs ?? 10_000),
        );
        return { tabId: target.id, url: view.webContents.getURL() || BLANK_URL };
      }
      case 'text': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        const script = action.selector
          ? elementActionScript(action.selector, 10_000, 'text')
          : 'document.body ? document.body.innerText : ""';
        return this.executeScript(view, script);
      }
      case 'html': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
        return this.executeScript(
          view,
          'document.documentElement ? document.documentElement.outerHTML : ""',
        );
      }
      case 'screenshot': {
        const target = this.captureTarget(workspaceId, action.tabId);
        const view = this.mustView(workspaceId, target);
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
    }
  }

  async destroy(): Promise<void> {
    this.detachAttachedView();
    await this.persist().catch(() => undefined);
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.views.clear();
  }

  private installSessionSecurity(): void {
    const browserSession = this.options.browserSession;
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    browserSession.webRequest.onBeforeRequest(
      {
        urls: ['http://*/*', 'https://*/*'],
        types: ['mainFrame', 'subFrame'],
      },
      (details, callback) => {
        void assertPublicUrl(details.url, 'native_browser_navigation', { failClosed: true })
          .then(() => callback({ cancel: false }))
          .catch(() => callback({ cancel: true }));
      },
    );
  }

  private ensureView(workspaceId: string, tab: NativeBrowserTabSnapshot): WebContentsView {
    const key = viewKey(workspaceId, tab.id);
    const existing = this.views.get(key);
    if (existing && !existing.webContents.isDestroyed()) return existing;

    const view =
      this.options.createView?.() ??
      new WebContentsView({
        webPreferences: {
          partition: BROWSER_PARTITION,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
    const contents = view.webContents;
    // Detached tabs remain alive, but Chromium may throttle them until the tab
    // is visible or an agent operation explicitly leases it below.
    contents.setBackgroundThrottling(true);
    contents.setZoomFactor(tab.zoom);
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) void this.openPopup(workspaceId, url);
      return { action: 'deny' };
    });
    contents.on('context-menu', (_event, params) => {
      this.showContextMenu(workspaceId, tab.id, view, params);
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
    });
    this.views.set(key, view);
    if (tab.url !== BLANK_URL) void contents.loadURL(tab.url).catch(() => undefined);
    return view;
  }

  private async openPopup(workspaceId: string, url: string): Promise<void> {
    try {
      await assertPublicUrl(url, 'native_browser_popup', { failClosed: true });
      await this.newTab({ workspaceId, url });
    } catch {
      // Popups are always denied by Electron. Unsafe/unresolvable targets are
      // intentionally discarded instead of leaking into the OS browser.
    }
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
    const snapshot = this.state.snapshot(workspaceId);
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
    this.options.onChanged(workspaceId, this.state.snapshot(workspaceId));
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

function cleanTitle(title: string): string {
  const value = title.trim();
  return value ? value.slice(0, 512) : 'New tab';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elementActionScript(
  selector: string,
  timeoutMs: number,
  action: 'click' | 'text',
): string {
  const selectorJson = JSON.stringify(selector);
  const actionScript =
    action === 'click'
      ? 'element.scrollIntoView({ block: "center", inline: "center" }); element.click(); return undefined;'
      : 'return element.textContent || "";';
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

function fillActionScript(selector: string, value: string, timeoutMs: number): string {
  const selectorJson = JSON.stringify(selector);
  const valueJson = JSON.stringify(value);
  return `(() => new Promise((resolve, reject) => {
    const selector = ${selectorJson};
    const value = ${valueJson};
    const deadline = Date.now() + ${timeoutMs};
    const find = () => {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) {
        try {
          element.focus();
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const prototype = element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (setter) setter.call(element, value);
            else element.value = value;
          } else if (element.isContentEditable) {
            element.textContent = value;
          } else {
            throw new Error('Target is not fillable: ' + selector);
          }
          element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          resolve(undefined);
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
