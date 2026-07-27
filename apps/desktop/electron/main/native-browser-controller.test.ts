import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeBrowserBridge, nativeBrowserBridgeSocket } from '@moxxy/desktop-host';
import {
  buildBrowserSessionTool,
  createNativeBrowserBridgeClient,
} from '@moxxy/plugin-browser';
import { asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';
import type { ToolContext } from '@moxxy/sdk';

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
      target: { type: 'selector', selector: 'main' },
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
      target: { type: 'selector', selector: '#buy' },
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
      target: { type: 'selector', selector: '#checkout' },
    });
    await controller.executeAgentAction('ws-1', {
      kind: 'type',
      target: { type: 'selector', selector: '#email' },
      value: 'hello@example.com',
      replace: true,
    });

    expect(view?.webContents.debugger.commands.filter(({ method }) => method.startsWith('Input.'))).toEqual([
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

  it('observes the visible page and clicks a revision-bound element reference', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.setScriptResults([
      {
        revision: 'rev-1',
        documentId: 'inbox-document',
        title: 'Inbox',
        url: 'https://mail.example.test/',
        visibleText: 'Inbox Compose',
        viewport: { width: 800, height: 600, deviceScaleFactor: 2 },
        nodes: [
          {
            ref: 'b1',
            role: 'button',
            name: 'Compose',
            selector: '#compose',
            bounds: { x: 80, y: 120, width: 120, height: 40 },
          },
        ],
      },
      { stale: false, x: 140, y: 140 },
    ]);

    const observation = await controller.executeAgentAction('ws-1', {
      kind: 'observe',
      mode: 'semantic',
      maxNodes: 80,
    });
    await controller.executeAgentAction('ws-1', {
      kind: 'click',
      target: { type: 'ref', ref: 'b1', revision: 'rev-1' },
    });

    expect(observation).toMatchObject({
      revision: 'rev-1',
      title: 'Inbox',
      nodes: [{ ref: 'b1', role: 'button', name: 'Compose' }],
    });
    expect(observation).not.toHaveProperty('nodes.0.selector');
    expect(view?.webContents.executedScripts[1]).toContain(
      'state.documentId !== "inbox-document"',
    );
    expect(view?.webContents.executedScripts[1]).toContain(
      'state.elements.get("b1")',
    );
    expect(view?.webContents.executedScripts[1]).not.toContain(
      'state.revision !== "rev-1"',
    );
    expect(
      view?.webContents.debugger.commands.filter((command) =>
        command.method.startsWith('Input.'),
      ),
    ).toEqual([
      {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mousePressed', x: 140, y: 140, button: 'left', clickCount: 1 },
      },
      {
        method: 'Input.dispatchMouseEvent',
        params: { type: 'mouseReleased', x: 140, y: 140, button: 'left', clickCount: 1 },
      },
    ]);
    await controller.destroy();
  });

  it('does not resend an unchanged canvas capture to the model', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    const canvasObservation = {
      revision: 'rev-canvas-1',
      title: 'Canvas editor',
      url: 'https://editor.example.test/',
      visibleText: 'Design editor',
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
      nodes: [],
      visualSurface: {
        kind: 'canvas',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    };
    view?.webContents.setScriptResults([canvasObservation, canvasObservation]);
    view?.webContents.setCaptureResult(new FakeNativeImage('same-canvas-frame'));

    const first = await controller.executeAgentAction('ws-1', {
      kind: 'observe',
      mode: 'auto',
    });
    const second = await controller.executeAgentAction('ws-1', {
      kind: 'observe',
      mode: 'auto',
    });

    expect(first).toMatchObject({
      mediaType: 'image/jpeg',
      base64: Buffer.from('same-canvas-frame').toString('base64'),
    });
    expect(second).not.toHaveProperty('base64');
    expect(second).not.toHaveProperty('mediaType');
    expect(second).toMatchObject({
      visualRevision: (first as { visualRevision: string }).visualRevision,
    });
    await controller.destroy();
  });

  it('adds accessibility targets from cross-origin frames to the shared observation', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.setScriptResults([
      {
        revision: 'rev-frame-1',
        title: 'Embedded checkout',
        url: 'https://shop.example.test/',
        visibleText: 'Checkout',
        viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
        nodes: [],
      },
      true,
    ]);
    view?.webContents.debugger.setResult('Page.getFrameTree', {
      frameTree: {
        frame: { id: 'main-frame' },
        childFrames: [{ frame: { id: 'payment-frame' } }],
      },
    });
    view?.webContents.debugger.setResult('Accessibility.getFullAXTree', {
      nodes: [
        {
          nodeId: 'ax-pay',
          backendDOMNodeId: 77,
          role: { value: 'button' },
          name: { value: 'Pay now' },
        },
      ],
    });
    view?.webContents.debugger.setResult('DOM.getBoxModel', {
      model: { border: [100, 200, 220, 200, 220, 240, 100, 240] },
    });
    view?.webContents.debugger.setResult('DOM.getNodeForLocation', { backendNodeId: 77 });

    const observation = await controller.executeAgentAction('ws-1', {
      kind: 'observe',
      mode: 'semantic',
      maxNodes: 20,
    });
    const observedRef = (observation as { nodes: Array<{ ref: string }> }).nodes[0]?.ref;
    expect(observedRef).toBeDefined();
    if (!observedRef) throw new Error('accessibility observation returns a stable ref');
    await controller.executeAgentAction('ws-1', {
      kind: 'click',
      target: { type: 'ref', ref: observedRef, revision: 'rev-frame-1' },
    });

    expect(observation).toMatchObject({
      nodes: [expect.objectContaining({ role: 'button', name: 'Pay now' })],
    });
    expect(view?.webContents.debugger.commands).toEqual(
      expect.arrayContaining([
        { method: 'Page.getFrameTree', params: undefined },
        {
          method: 'Accessibility.getFullAXTree',
          params: { frameId: 'payment-frame' },
        },
        { method: 'DOM.getBoxModel', params: { backendNodeId: 77 } },
      ]),
    );
    expect(view?.webContents.debugger.commands).toEqual(
      expect.arrayContaining([
        {
          method: 'Input.dispatchMouseEvent',
          params: { type: 'mousePressed', x: 160, y: 220, button: 'left', clickCount: 1 },
        },
      ]),
    );
    await controller.destroy();
  });

  it('rejects an accessibility ref when the CDP hit-test resolves a different node', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.setScriptResults([
      {
        revision: 'rev-frame-2',
        title: 'Embedded editor',
        url: 'https://editor.example.test/',
        visibleText: 'Editor',
        viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
        nodes: [],
      },
      true,
    ]);
    view?.webContents.debugger.setResult('Page.getFrameTree', {
      frameTree: { frame: { id: 'main-frame' } },
    });
    view?.webContents.debugger.setResult('Accessibility.getFullAXTree', {
      nodes: [{
        nodeId: 'ax-save',
        backendDOMNodeId: 77,
        role: { value: 'button' },
        name: { value: 'Save' },
      }],
    });
    view?.webContents.debugger.setResult('DOM.getBoxModel', {
      model: { border: [100, 200, 220, 200, 220, 240, 100, 240] },
    });

    const observation = await controller.executeAgentAction('ws-1', {
      kind: 'observe',
      mode: 'semantic',
      maxNodes: 20,
    });
    const observedRef = (observation as { nodes: Array<{ ref: string }> }).nodes[0]?.ref;
    if (!observedRef) throw new Error('accessibility observation returns a stable ref');
    view?.webContents.debugger.setResult('DOM.getNodeForLocation', { backendNodeId: 88 });

    await expect(controller.executeAgentAction('ws-1', {
      kind: 'click',
      target: { type: 'ref', ref: observedRef, revision: 'rev-frame-2' },
    })).rejects.toThrow('UNRELIABLE_TARGET');
    await controller.destroy();
  });

  it('rejects a stale or unknown element reference instead of clicking blindly', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];

    await expect(
      controller.executeAgentAction('ws-1', {
        kind: 'click',
        target: { type: 'ref', ref: 'b1', revision: 'stale-revision' },
      }),
    ).rejects.toThrow(/STALE_BROWSER_STATE/);
    expect(
      view?.webContents.debugger.commands.filter((command) =>
        command.method.startsWith('Input.'),
      ),
    ).toHaveLength(0);
    await controller.destroy();
  });

  it('invalidates observed refs when the user interacts with the shared page', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.setScriptResult('observe', {
      revision: 'rev-before-user-input',
      title: 'Editor',
      url: 'https://example.test/editor',
      visibleText: 'Save',
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
      nodes: [
        {
          ref: 'b1',
          role: 'button',
          name: 'Save',
          selector: '#save',
          bounds: { x: 40, y: 80, width: 100, height: 30 },
        },
      ],
    });

    await controller.executeAgentAction('ws-1', { kind: 'observe', mode: 'semantic' });
    view?.webContents.emit('input-event', {}, { type: 'mouseDown' });

    await expect(
      controller.executeAgentAction('ws-1', {
        kind: 'click',
        target: { type: 'ref', ref: 'b1', revision: 'rev-before-user-input' },
      }),
    ).rejects.toThrow(/STALE_BROWSER_STATE/);
    expect(
      view?.webContents.debugger.commands.filter((command) =>
        command.method.startsWith('Input.'),
      ),
    ).toHaveLength(0);
    await controller.destroy();
  });

  it('aborts an in-flight agent action when the user takes over the shared page', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    const load = createDeferred<void>();
    view?.webContents.setDeferredLoad(load.promise);

    const navigation = controller.executeAgentAction('ws-1', {
      kind: 'goto',
      url: 'https://93.184.216.34/slow-user-takeover',
      waitUntil: 'load',
    });
    await Promise.resolve();
    view?.webContents.emit('input-event', {}, { type: 'mouseDown' });

    await expect(navigation).rejects.toMatchObject({ code: 'USER_TAKEOVER' });
    expect(view?.webContents.stop).toHaveBeenCalledOnce();
    load.resolve(undefined);
    await controller.destroy();
  });

  it('revalidates a revision-bound ref before non-pointer actions', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    view?.webContents.setScriptResults([
      {
        revision: 'rev-select-1',
        title: 'Preferences',
        url: 'https://example.test/preferences',
        visibleText: 'Country',
        viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
        nodes: [
          {
            ref: 'b1',
            role: 'combobox',
            name: 'Country',
            selector: '#country',
            bounds: { x: 40, y: 80, width: 160, height: 30 },
          },
        ],
      },
      false,
    ]);

    await controller.executeAgentAction('ws-1', { kind: 'observe', mode: 'semantic' });
    await expect(
      controller.executeAgentAction('ws-1', {
        kind: 'select',
        target: { type: 'ref', ref: 'b1', revision: 'rev-select-1' },
        values: ['PL'],
      }),
    ).rejects.toThrow(/STALE_BROWSER_STATE/);
    expect(view?.webContents.executedScripts.at(-1)).toContain(
      'state.revision === "rev-select-1"',
    );
    await controller.destroy();
  });

  it('selects options, waits for page state, and uploads only a real file', async () => {
    const controller = await createController(views);
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    const root = await mkdtemp(path.join(os.tmpdir(), 'native-browser-upload-'));
    const uploadPath = path.join(root, 'avatar.png');
    await writeFile(uploadPath, 'image');
    view?.webContents.setScriptResults([['PL'], { matched: true }]);
    view?.webContents.debugger.setResult('Runtime.evaluate', {
      result: { objectId: 'input-object-1' },
    });

    await expect(
      controller.executeAgentAction('ws-1', {
        kind: 'select',
        target: { type: 'selector', selector: '#country' },
        values: ['PL'],
      }),
    ).resolves.toMatchObject({ selected: ['PL'] });
    await expect(
      controller.executeAgentAction('ws-1', {
        kind: 'wait',
        condition: { type: 'text', text: 'Saved' },
      }),
    ).resolves.toMatchObject({ tabId: expect.any(String) });
    await expect(
      controller.executeAgentAction('ws-1', {
        kind: 'upload',
        target: { type: 'selector', selector: 'input[type=file]' },
        paths: [uploadPath],
      }),
    ).resolves.toMatchObject({ files: 1 });

    expect(view?.webContents.executedScripts[0]).toContain('HTMLSelectElement');
    expect(view?.webContents.executedScripts[1]).toContain('Timed out waiting');
    expect(view?.webContents.debugger.commands).toEqual(
      expect.arrayContaining([
        {
          method: 'DOM.setFileInputFiles',
          params: { files: [uploadPath], objectId: 'input-object-1' },
        },
      ]),
    );
    await controller.destroy();
  });

  it('publishes agent control and lets the user stop a long-running action', async () => {
    const snapshots: Array<{ agentControl?: { action: string } }> = [];
    const controller = await createController(
      views,
      [],
      createNetworkLifecycle(),
      (snapshot) => snapshots.push(snapshot),
    );
    await controller.open({ workspaceId: 'ws-1' });
    const view = views[0];
    const load = createDeferred<void>();
    view?.webContents.setDeferredLoad(load.promise);

    const navigation = controller.executeAgentAction('ws-1', {
      kind: 'goto',
      url: 'https://93.184.216.34/slow',
      waitUntil: 'load',
    });
    await vi.waitFor(() =>
      expect(snapshots.at(-1)?.agentControl).toMatchObject({ action: 'goto' }),
    );

    await controller.stopAgentControl({ workspaceId: 'ws-1' });

    await expect(navigation).rejects.toMatchObject({ code: 'USER_ABORTED' });
    expect(view?.webContents.stop).toHaveBeenCalledOnce();
    expect(snapshots.at(-1)?.agentControl).toBeUndefined();
    load.resolve(undefined);
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

  it('routes the parsed browser_session tool through the bridge to the exact visible WebContentsView', async () => {
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
      const tool = buildBrowserSessionTool({ nativeBridge: client });
      const input = tool.inputSchema.parse({
        action: {
          kind: 'text',
          target: { type: 'selector', selector: 'main' },
        },
      });
      const result = await tool.handler(input, browserToolContext());

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

  it('adopts the exact Electron webContents for a foreground popup', async () => {
    const controller = await createController(views, requestGuards);
    const initial = await controller.open({ workspaceId: 'ws-1' });
    const first = views[0];
    const popupContents = new FakeWebContents();

    const popup = first?.webContents.openPopup('https://93.184.216.34/popup');
    expect(popup?.action).toBe('allow');
    expect(
      popup?.createWindow?.({
        webContents: popupContents,
      }),
    ).toBe(popupContents);
    expect(views).toHaveLength(2);
    expect(views[1]?.webContents).toBe(popupContents);
    expect(await controller.executeAgentAction('ws-1', { kind: 'tabs' })).toMatchObject({
      activeTabId: expect.not.stringMatching(initial.activeTabId),
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

  it('keeps a background popup inactive and manually loads it without Electron webContents', async () => {
    const controller = await createController(views, requestGuards);
    const initial = await controller.open({ workspaceId: 'ws-1' });
    const first = views[0];

    const popup = first?.webContents.openPopup(
      'https://93.184.216.34/background',
      'background-tab',
    );
    const popupContents = popup?.createWindow?.({});
    await Promise.resolve();

    expect(popup?.action).toBe('allow');
    expect(popupContents).toBe(views[1]?.webContents);
    expect(views[1]?.webContents.getURL()).toBe('https://93.184.216.34/background');
    expect(await controller.executeAgentAction('ws-1', { kind: 'tabs' })).toMatchObject({
      activeTabId: initial.activeTabId,
    });
    await controller.destroy();
  });

  it('allows an Electron-owned about:blank popup without loading it again', async () => {
    const controller = await createController(views, requestGuards);
    await controller.open({ workspaceId: 'ws-1' });
    const first = views[0];
    const popupContents = new FakeWebContents();
    const load = vi.spyOn(popupContents, 'loadURL');

    const popup = first?.webContents.openPopup('about:blank');
    expect(popup?.action).toBe('allow');
    expect(popup?.createWindow?.({ webContents: popupContents })).toBe(popupContents);
    expect(load).not.toHaveBeenCalled();
    await controller.destroy();
  });

  it('preserves Electron-owned POST popup contents without a duplicate GET load', async () => {
    const controller = await createController(views, requestGuards);
    await controller.open({ workspaceId: 'ws-1' });
    const popupContents = new FakeWebContents();
    const load = vi.spyOn(popupContents, 'loadURL');

    const popup = views[0]?.webContents.openPopup(
      'https://93.184.216.34/form-result',
      'foreground-tab',
    );
    expect(
      popup?.createWindow?.({
        webContents: popupContents,
        postBody: [{ type: 'rawData', bytes: Buffer.from('message=hello') }],
      }),
    ).toBe(popupContents);

    expect(load).not.toHaveBeenCalled();
    await controller.destroy();
  });

  it('removes a popup tab when the page closes its own webContents', async () => {
    const controller = await createController(views, requestGuards);
    const initial = await controller.open({ workspaceId: 'ws-1' });
    const popupContents = new FakeWebContents();
    const popup = views[0]?.webContents.openPopup('https://93.184.216.34/self-close');
    popup?.createWindow?.({ webContents: popupContents });

    popupContents.close();

    await vi.waitFor(async () => {
      expect(await controller.executeAgentAction('ws-1', { kind: 'tabs' })).toMatchObject({
        activeTabId: initial.activeTabId,
        tabs: initial.tabs,
      });
    });
    await controller.destroy();
  });

  it('closes an adopted popup through tab controls without double-removing state', async () => {
    const controller = await createController(views, requestGuards);
    const initial = await controller.open({ workspaceId: 'ws-1' });
    const popupContents = new FakeWebContents();
    views[0]?.webContents
      .openPopup('https://93.184.216.34/user-close')
      .createWindow?.({ webContents: popupContents });
    const opened = await controller.executeAgentAction('ws-1', { kind: 'tabs' });
    const popupTabId = (opened as { activeTabId: string }).activeTabId;

    await expect(controller.closeTab({ workspaceId: 'ws-1', tabId: popupTabId })).resolves.toMatchObject({
      activeTabId: initial.activeTabId,
      tabs: initial.tabs,
    });
    expect(popupContents.closed).toBe(true);
    await controller.destroy();
  });

  it('installs popup handling recursively on adopted webContents', async () => {
    const controller = await createController(views, requestGuards);
    await controller.open({ workspaceId: 'ws-1' });
    const childContents = new FakeWebContents();
    const grandchildContents = new FakeWebContents();
    views[0]?.webContents
      .openPopup('https://93.184.216.34/child')
      .createWindow?.({ webContents: childContents });

    const nested = childContents.openPopup('https://93.184.216.34/grandchild');
    expect(nested.action).toBe('allow');
    expect(nested.createWindow?.({ webContents: grandchildContents })).toBe(grandchildContents);
    expect(views).toHaveLength(3);
    await controller.destroy();
  });

  it('rolls back an Electron popup when the adopted view cannot be created', async () => {
    const controller = await createController(
      views,
      requestGuards,
      createNetworkLifecycle(),
      vi.fn(),
      createSessionHarness(),
      (webContents) => {
        if (webContents) throw new Error('adoption failed');
        return new FakeView();
      },
    );
    const initial = await controller.open({ workspaceId: 'ws-1' });
    const popupContents = new FakeWebContents();
    const popup = views[0]?.webContents.openPopup('https://93.184.216.34/failure');

    expect(() => popup?.createWindow?.({ webContents: popupContents })).toThrow('adoption failed');
    expect(popupContents.closed).toBe(true);
    expect(await controller.executeAgentAction('ws-1', { kind: 'tabs' })).toMatchObject(initial);
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

  it('keeps site permissions denied until the trusted renderer resolves the origin request', async () => {
    const session = createSessionHarness();
    const controller = await createController(views, [], createNetworkLifecycle(), vi.fn(), session);
    const opened = await controller.open({ workspaceId: 'ws-1' });
    const decision = vi.fn();
    session.permissionRequest?.(
      views[0]?.webContents as never,
      'media',
      decision,
      {
        requestingUrl: 'https://example.com/call',
        securityOrigin: 'https://example.com',
        mediaTypes: ['audio'],
      },
    );

    const pending = await controller.executeAgentAction('ws-1', { kind: 'tabs' });
    expect(pending).toMatchObject({
      permissionRequest: {
        tabId: opened.activeTabId,
        origin: 'https://example.com',
        permission: 'microphone',
      },
    });
    const request = (pending as { permissionRequest: { id: string } }).permissionRequest;
    await controller.resolvePermission({ workspaceId: 'ws-1', requestId: request.id, allow: true });

    expect(decision).toHaveBeenCalledWith(true);
    expect(await controller.executeAgentAction('ws-1', { kind: 'tabs' })).not.toHaveProperty(
      'permissionRequest',
    );
    expect(
      session.permissionCheck?.(
        views[0]?.webContents as never,
        'media',
        'https://example.com',
        { mediaType: 'audio', securityOrigin: 'https://example.com' },
      ),
    ).toBe(true);
    await controller.destroy();
  });

  it('publishes page downloads, allocates a safe non-overwriting path and allows cancellation', async () => {
    const session = createSessionHarness();
    const controller = await createController(views, [], createNetworkLifecycle(), vi.fn(), session);
    await controller.open({ workspaceId: 'ws-1' });
    const item = new FakeDownloadItem('../report.pdf');

    session.willDownload?.(item as never, views[0]?.webContents as never);

    const active = await controller.executeAgentAction('ws-1', { kind: 'tabs' });
    expect(active).toMatchObject({
      downloads: [
        {
          filename: 'report.pdf',
          state: 'progressing',
          receivedBytes: 16,
          totalBytes: 64,
        },
      ],
    });
    expect(item.savePath).toMatch(/downloads\/report\.pdf$/);
    const download = (active as { downloads: Array<{ id: string }> }).downloads[0];
    expect(download).toBeDefined();
    await controller.cancelDownload({ workspaceId: 'ws-1', downloadId: download?.id ?? '' });
    expect(item.cancel).toHaveBeenCalledOnce();
    item.finish('cancelled');
    expect(await controller.executeAgentAction('ws-1', { kind: 'tabs' })).toMatchObject({
      downloads: [{ state: 'cancelled' }],
    });
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

interface SessionHarness {
  permissionCheck?: (
    webContents: unknown,
    permission: string,
    origin: string,
    details: { mediaType?: 'video' | 'audio' | 'unknown'; securityOrigin?: string },
  ) => boolean;
  permissionRequest?: (
    webContents: unknown,
    permission: string,
    callback: (allow: boolean) => void,
    details: {
      requestingUrl: string;
      securityOrigin?: string;
      mediaTypes?: Array<'video' | 'audio'>;
    },
  ) => void;
  willDownload?: (item: unknown, webContents: unknown) => void;
}

function createSessionHarness(): SessionHarness {
  return {};
}

function createNetworkLifecycle(): NetworkLifecycle {
  return { before: [], completed: [], failed: [] };
}

async function createController(
  views: FakeView[],
  requestGuards: RequestGuard[] = [],
  lifecycle: NetworkLifecycle = createNetworkLifecycle(),
  onChanged: (snapshot: { agentControl?: { action: string } }) => void = vi.fn(),
  sessionHarness: SessionHarness = createSessionHarness(),
  viewFactory?: (webContents?: FakeWebContents) => FakeView,
): Promise<ElectronNativeBrowserController> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'native-controller-'));
  const controller = new ElectronNativeBrowserController({
    browserSession: {
      setPermissionCheckHandler: vi.fn((handler: SessionHarness['permissionCheck']) => {
        sessionHarness.permissionCheck = handler;
      }),
      setPermissionRequestHandler: vi.fn((handler: SessionHarness['permissionRequest']) => {
        sessionHarness.permissionRequest = handler;
      }),
      on: vi.fn((event: string, handler: (event: unknown, item: unknown, webContents: unknown) => void) => {
        if (event === 'will-download') {
          sessionHarness.willDownload = (item, webContents) => handler({}, item, webContents);
        }
      }),
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
    downloadsDir: path.join(userDataDir, 'downloads'),
    getMainWindow: () => null,
    onChanged: (_workspaceId, snapshot) => onChanged(snapshot),
    createView: (webContents) => {
      const adopted = webContents as unknown as FakeWebContents | undefined;
      const view = viewFactory?.(adopted) ?? new FakeView(adopted);
      views.push(view);
      return view as never;
    },
  });
  await controller.start();
  return controller;
}

class FakeView {
  readonly webContents: FakeWebContents;
  private bounds = { x: 0, y: 0, width: 800, height: 600 };

  constructor(webContents = new FakeWebContents()) {
    this.webContents = webContents;
  }

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
  readonly stop = vi.fn();
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
  private captureResult: FakeNativeImage | null = null;
  private popupHandler: ((details: { url: string; disposition: string }) => {
    action: 'allow' | 'deny';
    createWindow?: (options: PopupCreateWindowOptions) => unknown;
  }) | null = null;

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

  setCaptureResult(value: FakeNativeImage): void {
    this.captureResult = value;
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
  setWindowOpenHandler(handler: (details: { url: string; disposition: string }) => {
    action: 'allow' | 'deny';
    createWindow?: (options: PopupCreateWindowOptions) => unknown;
  }): void {
    this.popupHandler = handler;
  }
  openPopup(
    url: string,
    disposition = 'new-window',
  ): {
    action: 'allow' | 'deny';
    createWindow?: (options: PopupCreateWindowOptions) => unknown;
  } {
    if (!this.popupHandler) throw new Error('popup handler is not installed');
    return this.popupHandler({ url, disposition });
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
  capturePage(...args: unknown[]): Promise<FakeNativeImage> {
    this.captureCalls.push(args);
    if (!this.captureResult) return Promise.reject(new Error('not used'));
    return Promise.resolve(this.captureResult);
  }
}

class FakeNativeImage {
  constructor(private readonly data: string) {}

  getSize(): { width: number; height: number } {
    return { width: 800, height: 600 };
  }

  resize(): FakeNativeImage {
    return this;
  }

  toJPEG(): Buffer {
    return Buffer.from(this.data);
  }

  toPNG(): Buffer {
    return Buffer.from(this.data);
  }
}

interface PopupCreateWindowOptions {
  readonly webContents?: FakeWebContents;
  readonly postBody?: ReadonlyArray<{
    readonly type: 'rawData';
    readonly bytes: Buffer;
  }>;
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
    if (this.results.has(method)) return Promise.resolve(this.results.get(method));
    if (method === 'DOM.getNodeForLocation') return Promise.resolve({ backendNodeId: 1 });
    return Promise.resolve(undefined);
  }
}

class FakeDownloadItem extends EventEmitter {
  readonly cancel = vi.fn();
  savePath = '';

  constructor(private readonly filename: string) {
    super();
  }

  getFilename(): string {
    return this.filename;
  }

  setSavePath(value: string): void {
    this.savePath = value;
  }

  getReceivedBytes(): number {
    return 16;
  }

  getTotalBytes(): number {
    return 64;
  }

  finish(state: 'completed' | 'cancelled' | 'interrupted'): void {
    this.emit('done', {}, state);
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

function browserToolContext(): ToolContext {
  return {
    sessionId: asSessionId('native-browser-session'),
    turnId: asTurnId('native-browser-turn'),
    callId: asToolCallId('native-browser-call'),
    cwd: '/tmp',
    signal: new AbortController().signal,
    log: {
      length: 0,
      at: () => undefined,
      slice: () => [],
      ofType: () => [],
      byTurn: () => [],
      toJSON: () => [],
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}
