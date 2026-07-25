import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeBrowserBridge, nativeBrowserBridgeSocket } from '@moxxy/desktop-host';
import { createNativeBrowserBridgeClient } from '@moxxy/plugin-browser';

vi.mock('electron', () => ({ WebContentsView: class {} }));

import { ElectronNativeBrowserController } from './native-browser-controller.js';

describe('ElectronNativeBrowserController agent operations', () => {
  let views: FakeView[];

  beforeEach(() => {
    views = [];
  });

  it('runs agent actions on the same native tab the user opened', async () => {
    const controller = await createController(views);
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
    expect((await controller.executeAgentAction('ws-1', { kind: 'tabs' }))).toMatchObject({
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
    deferred.resolve(undefined);
    await operation;

    expect(first?.webContents.executedScripts).toHaveLength(1);
    expect(second?.webContents.executedScripts).toHaveLength(0);
    await controller.destroy();
  });

  it('keeps hidden tabs alive and available to the agent', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.setScriptResult('html', '<html><body>background</body></html>');
    await controller.setVisible({ workspaceId: 'ws-1', visible: false });

    const html = await controller.executeAgentAction('ws-1', { kind: 'html' });

    expect(html).toBe('<html><body>background</body></html>');
    expect(view?.webContents.closed).toBe(false);
    expect(view?.webContents.backgroundThrottling).toBe(false);
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
});

async function createController(views: FakeView[]): Promise<ElectronNativeBrowserController> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'native-controller-'));
  const controller = new ElectronNativeBrowserController({
    browserSession: {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() },
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
  readonly executedScripts: string[] = [];
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
  private deferredScript: Promise<unknown> | null = null;

  setScriptResult(_kind: string, value: unknown): void {
    this.scriptResult = value;
  }

  setDeferredScript(value: Promise<unknown>): void {
    this.deferredScript = value;
  }

  executeJavaScript(script: string): Promise<unknown> {
    this.executedScripts.push(script);
    if (this.deferredScript) return this.deferredScript;
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
  setWindowOpenHandler(_handler: unknown): void {}
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
    return Promise.resolve();
  }
  capturePage(): Promise<never> {
    return Promise.reject(new Error('not used'));
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
