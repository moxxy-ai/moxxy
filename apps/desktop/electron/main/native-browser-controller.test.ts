import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeBrowserBridge, nativeBrowserBridgeSocket } from '@moxxy/desktop-host';
import { createNativeBrowserBridgeClient } from '@moxxy/plugin-browser';

const electronMocks = vi.hoisted(() => ({
  popup: vi.fn(),
  templates: [] as Array<Array<Record<string, unknown>>>,
}));

vi.mock('electron', () => ({
  WebContentsView: class {},
  Menu: {
    buildFromTemplate: (template: Array<Record<string, unknown>>) => {
      electronMocks.templates.push(template);
      return { popup: electronMocks.popup };
    },
  },
}));

import { ElectronNativeBrowserController } from './native-browser-controller.js';

describe('ElectronNativeBrowserController agent operations', () => {
  let views: FakeView[];
  let requestGuards: RequestGuard[];

  beforeEach(() => {
    views = [];
    requestGuards = [];
    electronMocks.popup.mockClear();
    electronMocks.templates.length = 0;
  });

  it('runs agent actions on the same native tab the user opened', async () => {
    const controller = await createController(views, requestGuards);
    const snapshot = await controller.open({ workspaceId: 'ws-1' });
    const activeTabId = snapshot.activeTabId;
    const view = views[0];
    expect(view).toBeDefined();
    view?.webContents.setScriptResult('text', 'the visible page');

    const result = await controller.executeAgentAction('ws-1', {
      kind: 'text',
      selector: 'main',
    });

    expect(result).toBe('the visible page');
    expect(view?.webContents.executedScripts).toHaveLength(1);
    expect(view?.webContents.executedScripts[0]).toContain('main');
    expect(await controller.executeAgentAction('ws-1', { kind: 'tabs' })).toMatchObject({
      activeTabId,
    });
    await controller.destroy();
  });

  it('captures the active tab before awaiting so a user tab switch cannot redirect the operation', async () => {
    const controller = await createController(views);
    const initial = await controller.open({ workspaceId: 'ws-1' });
    const first = views[0];
    expect(first).toBeDefined();
    const deferred = createDeferred<unknown>();
    first?.webContents.setDeferredScript(deferred.promise);

    const operation = controller.executeAgentAction('ws-1', {
      kind: 'click',
      selector: '#buy',
    });
    const afterNewTab = await controller.newTab({ workspaceId: 'ws-1' });
    expect(afterNewTab.activeTabId).not.toBe(initial.activeTabId);
    const second = views[1];
    expect(second).toBeDefined();
    deferred.resolve({ x: 120, y: 80 });
    await operation;

    expect(first?.webContents.executedScripts).toHaveLength(1);
    expect(second?.webContents.executedScripts).toHaveLength(0);
    await controller.destroy();
  });

  it('resolves a domcontentloaded navigation as soon as the top-level DOM is ready', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    const load = createDeferred<void>();
    view?.webContents.setDeferredLoad(load.promise);

    const navigation = controller.executeAgentAction('ws-1', {
      kind: 'goto',
      url: 'https://93.184.216.34/dom-ready',
      waitUntil: 'domcontentloaded',
    });
    let settled = false;
    void navigation.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    view?.webContents.emit('dom-ready');

    await expect(navigation).resolves.toMatchObject({
      url: 'https://93.184.216.34/dom-ready',
    });
    expect(settled).toBe(true);
    load.resolve(undefined);
    await controller.destroy();
  });

  it('subscribes to dom-ready before starting a fast navigation', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    const load = createDeferred<void>();
    view?.webContents.setDeferredLoad(load.promise);
    view?.webContents.emitDomReadyDuringLoad();

    const navigation = controller.executeAgentAction('ws-1', {
      kind: 'goto',
      url: 'https://93.184.216.34/fast-dom',
      waitUntil: 'domcontentloaded',
      timeoutMs: 100,
    });

    await expect(navigation).resolves.toMatchObject({
      url: 'https://93.184.216.34/fast-dom',
    });
    load.resolve(undefined);
    await controller.destroy();
  });

  it('waits for the full load event when waitUntil is load', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    const load = createDeferred<void>();
    view?.webContents.setDeferredLoad(load.promise);

    const navigation = controller.executeAgentAction('ws-1', {
      kind: 'goto',
      url: 'https://93.184.216.34/load',
      waitUntil: 'load',
    });
    let settled = false;
    void navigation.finally(() => {
      settled = true;
    });
    view?.webContents.emit('dom-ready');
    await Promise.resolve();
    expect(settled).toBe(false);

    load.resolve(undefined);

    await expect(navigation).resolves.toMatchObject({
      url: 'https://93.184.216.34/load',
    });
    await controller.destroy();
  });

  it('waits for a quiet network window after the final request', async () => {
    vi.useFakeTimers();
    try {
      const lifecycle = createNetworkLifecycle();
      const controller = await createController(views, [], lifecycle);
      await controller.open({ workspaceId: 'ws-1' });
      const view = views[0];
      const load = createDeferred<void>();
      view?.webContents.setDeferredLoad(load.promise);

      const navigation = controller.executeAgentAction('ws-1', {
        kind: 'goto',
        url: 'https://93.184.216.34/network-idle',
        waitUntil: 'networkidle',
      });
      await vi.advanceTimersByTimeAsync(0);
      const request = lifecycle.before[0];
      expect(request).toBeDefined();
      request?.(
        {
          id: 1,
          webContentsId: view?.webContents.id,
          resourceType: 'xhr',
          url: 'https://93.184.216.34/data',
        },
        vi.fn(),
      );
      let settled = false;
      void navigation.finally(() => {
        settled = true;
      });

      load.resolve(undefined);
      await vi.advanceTimersByTimeAsync(500);
      expect(settled).toBe(false);
      lifecycle.completed[0]?.({
        id: 1,
        webContentsId: view?.webContents.id,
        url: 'https://93.184.216.34/data',
      });
      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(navigation).resolves.toMatchObject({
        url: 'https://93.184.216.34/network-idle',
      });
      await controller.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the network quiet window only after the document has loaded', async () => {
    vi.useFakeTimers();
    try {
      const controller = await createController(views);
      await controller.open({ workspaceId: 'ws-1' });
      const view = views[0];
      const load = createDeferred<void>();
      view?.webContents.setDeferredLoad(load.promise);

      const navigation = controller.executeAgentAction('ws-1', {
        kind: 'goto',
        url: 'https://93.184.216.34/slow-load',
        waitUntil: 'networkidle',
      });
      let settled = false;
      void navigation.finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(settled).toBe(false);

      load.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(499);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(navigation).resolves.toMatchObject({
        url: 'https://93.184.216.34/slow-load',
      });
      await controller.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses fixed private DevTools commands for a full-page screenshot', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.debugger.setResult('Page.getLayoutMetrics', {
      cssContentSize: { x: 0, y: 0, width: 900, height: 6_000 },
    });
    view?.webContents.debugger.setResult('Page.captureScreenshot', {
      data: Buffer.from('full-page-png').toString('base64'),
    });

    const screenshot = await controller.executeAgentAction('ws-1', {
      kind: 'screenshot',
      fullPage: true,
    });

    expect(screenshot).toMatchObject({
      mediaType: 'image/png',
      base64: Buffer.from('full-page-png').toString('base64'),
    });
    expect(view?.webContents.captureCalls).toHaveLength(0);
    expect(view?.webContents.debugger.commands).toEqual([
      { method: 'Page.getLayoutMetrics', params: undefined },
      {
        method: 'Page.captureScreenshot',
        params: {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: 900, height: 6_000, scale: 1 },
        },
      },
    ]);
    expect(view?.webContents.debugger.attach).toHaveBeenCalledWith('1.3');
    expect(view?.webContents.debugger.detach).toHaveBeenCalledOnce();
    await controller.destroy();
  });

  it('rejects a page-sized capture that exceeds the bounded memory budget', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.debugger.setResult('Page.getLayoutMetrics', {
      cssContentSize: { x: 0, y: 0, width: 20_000, height: 20_000 },
    });

    await expect(
      controller.executeAgentAction('ws-1', { kind: 'screenshot', fullPage: true }),
    ).rejects.toThrow('safe capture limit');
    expect(view?.webContents.debugger.commands).toEqual([
      { method: 'Page.getLayoutMetrics', params: undefined },
    ]);
    await controller.destroy();
  });

  it('dispatches trusted browser input for agent click and fill actions', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.setScriptResults([
      { x: 240, y: 160 },
      { fillable: true },
    ]);

    await controller.executeAgentAction('ws-1', {
      kind: 'click',
      selector: '#checkout',
    });
    await controller.executeAgentAction('ws-1', {
      kind: 'fill',
      selector: '#email',
      value: 'hello@example.com',
    });

    expect(view?.webContents.debugger.commands).toEqual([
      {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mousePressed', x: 240, y: 160, button: 'left', clickCount: 1 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseReleased', x: 240, y: 160, button: 'left', clickCount: 1 },
      },
      {
        method: 'Input.insertText',
        params: { text: 'hello@example.com' },
      },
    ]);
    expect(view?.webContents.executedScripts[0]).not.toContain('element.click()');
    expect(view?.webContents.executedScripts[1]).not.toContain('dispatchEvent');
    await controller.destroy();
  });

  it('throttles a hidden tab except while an agent operation is active', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    const deferred = createDeferred<unknown>();
    view?.webContents.setDeferredScript(deferred.promise);
    await controller.setVisible({ workspaceId: 'ws-1', visible: false });

    expect(view?.webContents.backgroundThrottling).toBe(true);

    const html = controller.executeAgentAction('ws-1', { kind: 'html' });
    expect(view?.webContents.backgroundThrottling).toBe(false);
    deferred.resolve('<html><body>background</body></html>');

    await expect(html).resolves.toBe('<html><body>background</body></html>');
    expect(view?.webContents.closed).toBe(false);
    expect(view?.webContents.backgroundThrottling).toBe(true);
    await controller.destroy();
  });

  it('lets the runner bridge operate the exact WebContentsView shown to the user', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const visibleView = views[0];
    visibleView?.webContents.setScriptResult('text', 'shared native page');
    const root = await mkdtemp(path.join(os.tmpdir(), 'native-controller-bridge-'));
    const bridge = new NativeBrowserBridge({
      socketPath: nativeBrowserBridgeSocket(root, 'darwin'),
      execute: (workspaceId, action) => controller.executeAgentAction(workspaceId, action),
    });
    await bridge.start();
    try {
      const environment = bridge.runnerEnvironment('ws-1');
      const client = createNativeBrowserBridgeClient(environment);
      expect(client).not.toBeNull();
      const result = await client?.call({ kind: 'text', selector: 'main' });

      expect(result).toBe('shared native page');
      expect(views).toHaveLength(1);
      expect(visibleView?.webContents.executedScripts).toHaveLength(1);
    } finally {
      await bridge.stop();
      await controller.destroy();
    }
  });

  it('shows a native context menu for page selection and editing', async () => {
    const controller = await createController(views, requestGuards);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];

    view?.webContents.emit(
      'context-menu',
      {},
      {
        isEditable: true,
        selectionText: 'selected text',
        linkURL: '',
      },
    );

    expect(electronMocks.templates).toHaveLength(1);
    expect(electronMocks.templates[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'cut' }),
        expect.objectContaining({ role: 'copy' }),
        expect.objectContaining({ role: 'paste' }),
      ]),
    );
    expect(electronMocks.popup).toHaveBeenCalledOnce();
    await controller.destroy();
  });

  it('opens a public HTTP popup as a Moxxy tab and blocks dangerous protocols', async () => {
    const controller = await createController(views, requestGuards);
    const initial = await controller.open({ workspaceId: 'ws-1' });
    const first = views[0];

    expect(first?.webContents.openPopup('https://93.184.216.34/popup')).toEqual({ action: 'deny' });
    await vi.waitFor(() => expect(views).toHaveLength(2));
    expect(await controller.executeAgentAction('ws-1', { kind: 'tabs' })).toMatchObject({
      tabs: expect.arrayContaining([
        expect.objectContaining({ url: 'https://93.184.216.34/popup' }),
      ]),
    });

    expect(first?.webContents.openPopup('javascript:alert(1)')).toEqual({
      action: 'deny',
    });
    await Promise.resolve();
    expect(views).toHaveLength(2);
    expect(initial.tabs).toHaveLength(1);
    await controller.destroy();
  });

  it('blocks private main-frame redirects and iframes at the shared session boundary', async () => {
    const controller = await createController(views, requestGuards);
    expect(requestGuards).toHaveLength(1);
    const guard = requestGuards[0];
    expect(guard).toBeDefined();
    const redirect = vi.fn();
    guard?.(
      {
        id: 1,
        webContentsId: 42,
        resourceType: 'mainFrame',
        url: 'http://127.0.0.1/redirect-target',
      },
      redirect,
    );
    await vi.waitFor(() => expect(redirect).toHaveBeenCalledWith({ cancel: true }));

    const iframe = vi.fn();
    guard?.(
      {
        id: 2,
        webContentsId: 42,
        resourceType: 'subFrame',
        url: 'http://[::1]/iframe-content',
      },
      iframe,
    );
    await vi.waitFor(() => expect(iframe).toHaveBeenCalledWith({ cancel: true }));
    await controller.destroy();
  });
});

type RequestGuard = (
  details: {
    readonly id?: number;
    readonly webContentsId?: number;
    readonly resourceType?: string;
    readonly url: string;
  },
  callback: (result: { readonly cancel: boolean }) => void,
) => void;

type RequestCompleted = (details: {
  readonly id: number;
  readonly webContentsId?: number;
  readonly url: string;
}) => void;

interface NetworkLifecycle {
  readonly before: RequestGuard[];
  readonly completed: RequestCompleted[];
  readonly failed: RequestCompleted[];
}

function createNetworkLifecycle(): NetworkLifecycle {
  return { before: [], completed: [], failed: [] };
}

async function createController(
  views: FakeView[],
  requestGuards: RequestGuard[] = [],
  lifecycle: NetworkLifecycle = createNetworkLifecycle(),
): Promise<ElectronNativeBrowserController> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'native-controller-'));
  const controller = new ElectronNativeBrowserController({
    browserSession: {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      webRequest: {
        onBeforeRequest: vi.fn((_filter: unknown, guard: RequestGuard) => {
          requestGuards.push(guard);
          lifecycle.before.push(guard);
        }),
        onCompleted: vi.fn((_filter: unknown, listener: RequestCompleted) => {
          lifecycle.completed.push(listener);
        }),
        onErrorOccurred: vi.fn((_filter: unknown, listener: RequestCompleted) => {
          lifecycle.failed.push(listener);
        }),
      },
    } as never,
    userDataDir,
    getMainWindow: () => null,
    onChanged: vi.fn(),
    createView: () => {
      const view = new FakeView();
      views.push(view);
      return view as never;
    },
  });
  await controller.start();
  return controller;
}

class FakeView {
  readonly webContents = new FakeWebContents();
  private bounds = { x: 0, y: 0, width: 800, height: 600 };

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = bounds;
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return this.bounds;
  }

  setVisible(_visible: boolean): void {}
}

class FakeWebContents extends EventEmitter {
  readonly id = 42;
  readonly executedScripts: string[] = [];
  readonly captureCalls: unknown[] = [];
  readonly debugger = new FakeDebugger();
  readonly navigationHistory = {
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: vi.fn(),
    goForward: vi.fn(),
  };
  closed = false;
  backgroundThrottling = true;
  private zoom = 1;
  private url = 'about:blank';
  private scriptResult: unknown;
  private scriptResults: unknown[] = [];
  private deferredScript: Promise<unknown> | null = null;
  private deferredLoad: Promise<void> | null = null;
  private emitDomReadyOnLoad = false;
  private popupHandler: ((details: { url: string }) => { action: 'deny' }) | null = null;

  setScriptResult(_kind: string, value: unknown): void {
    this.scriptResult = value;
  }

  setDeferredScript(value: Promise<unknown>): void {
    this.deferredScript = value;
  }

  setScriptResults(values: unknown[]): void {
    this.scriptResults = [...values];
  }

  setDeferredLoad(value: Promise<void>): void {
    this.deferredLoad = value;
  }

  emitDomReadyDuringLoad(): void {
    this.emitDomReadyOnLoad = true;
  }

  executeJavaScript(script: string): Promise<unknown> {
    this.executedScripts.push(script);
    if (this.deferredScript) return this.deferredScript;
    if (this.scriptResults.length > 0) return Promise.resolve(this.scriptResults.shift());
    return Promise.resolve(this.scriptResult);
  }

  isDestroyed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    this.emit('destroyed');
  }

  setBackgroundThrottling(enabled: boolean): void {
    this.backgroundThrottling = enabled;
  }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void {
    this.popupHandler = handler;
  }
  openPopup(url: string): { action: 'deny' } {
    if (!this.popupHandler) throw new Error('popup handler is not installed');
    return this.popupHandler({ url });
  }
  setZoomFactor(value: number): void {
    this.zoom = value;
  }
  getZoomFactor(): number {
    return this.zoom;
  }
  getURL(): string {
    return this.url;
  }
  isLoading(): boolean {
    return false;
  }
  reload(): void {}
  loadURL(url: string): Promise<void> {
    this.url = url;
    if (this.emitDomReadyOnLoad) this.emit('dom-ready');
    return this.deferredLoad ?? Promise.resolve();
  }
  capturePage(...args: unknown[]): Promise<never> {
    this.captureCalls.push(args);
    return Promise.reject(new Error('not used'));
  }
}

class FakeDebugger extends EventEmitter {
  readonly attach = vi.fn(() => {
    this.attached = true;
  });
  readonly detach = vi.fn(() => {
    this.attached = false;
  });
  readonly commands: Array<{ method: string; params: unknown }> = [];
  private attached = false;
  private readonly results = new Map<string, unknown>();

  isAttached(): boolean {
    return this.attached;
  }

  setResult(method: string, result: unknown): void {
    this.results.set(method, result);
  }

  sendCommand(method: string, params?: unknown): Promise<unknown> {
    this.commands.push({ method, params });
    return Promise.resolve(this.results.get(method));
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
