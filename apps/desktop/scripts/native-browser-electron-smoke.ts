import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { app, BrowserWindow, session, WebContentsView } from 'electron';

import { ElectronNativeBrowserController } from '../electron/main/native-browser-controller.js';

const TEST_ORIGIN = 'https://93.184.216.34';
const WORKSPACE_ID = 'electron-smoke';
const resultPath = process.env.MOXXY_NATIVE_BROWSER_SMOKE_RESULT;

if (!resultPath) throw new Error('MOXXY_NATIVE_BROWSER_SMOKE_RESULT is required');
const smokeResultPath = resultPath;

void run();

async function run(): Promise<void> {
  const progressPath = `${smokeResultPath}.progress`;
  const progress = async (step: string): Promise<void> => {
    await appendFile(progressPath, `${step}\n`, 'utf8');
  };
  let userDataDir: string | null = null;
  let browserSession: Electron.Session | null = null;
  let window: BrowserWindow | null = null;
  let controller: ElectronNativeBrowserController | null = null;
  let exitCode = 0;

  try {
    await progress('module-loaded');
    await app.whenReady();
    await progress('app-ready');
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'moxxy-native-browser-electron-'));
    const partition = `persist:moxxy-native-browser-smoke-${Date.now()}`;
    browserSession = session.fromPartition(partition);
    const views: WebContentsView[] = [];
    window = new BrowserWindow({
      width: 920,
      height: 720,
      show: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await window.loadURL('about:blank');
    app.focus({ steal: true });
    window.focus();

    await browserSession.protocol.handle('https', (request) => {
      const url = new URL(request.url);
      if (url.origin !== TEST_ORIGIN) return new Response('Not found', { status: 404 });
      return new Response(testPage(url.pathname), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    await progress('protocol-ready');

    controller = new ElectronNativeBrowserController({
      browserSession,
      userDataDir,
      getMainWindow: () => window,
      onChanged: () => undefined,
      createView: () => {
        const view = new WebContentsView({
          webPreferences: {
            partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        });
        views.push(view);
        return view;
      },
    });
    await controller.start();
    await progress('controller-started');
    const opened = await controller.open({ workspaceId: WORKSPACE_ID });
    await controller.setBounds({
      workspaceId: WORKSPACE_ID,
      rect: { x: 0, y: 0, width: 900, height: 680 },
      rendererViewport: { width: 900, height: 680 },
    });
    await controller.navigate({
      workspaceId: WORKSPACE_ID,
      tabId: opened.activeTabId,
      url: `${TEST_ORIGIN}/form`,
    });
    await progress('form-loaded');

    await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'fill',
      selector: '#message',
      value: 'Zażółć gęślą jaźń — native input',
    });
    await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'click',
      selector: '#apply',
    });
    const renderedText = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'text',
      selector: '#result',
    });
    assertEqual(renderedText, 'Zażółć gęślą jaźń — native input', 'shared form result');
    await progress('form-shared');

    const firstView = views[0];
    if (!firstView) throw new Error('first WebContentsView was not created');
    await firstView.webContents.executeJavaScript(
      'document.querySelector("#message").focus(); document.querySelector("#message").value = "";',
      true,
    );
    firstView.webContents.focus();
    await firstView.webContents.insertText('Direct Electron text 日本語');
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const directInput = await firstView.webContents.executeJavaScript(
      'document.querySelector("#message").value',
      true,
    );
    assertEqual(directInput, 'Direct Electron text 日本語', 'direct WebContents input');

    const interactionStarted = performance.now();
    await firstView.webContents.executeJavaScript('window.scrollTo(0, 2400)', true);
    const scrollY = await firstView.webContents.executeJavaScript('window.scrollY', true);
    const interactionMs = performance.now() - interactionStarted;
    if (Number(scrollY) < 2_000) throw new Error(`native scroll did not move the page: ${scrollY}`);

    const captureStarted = performance.now();
    const capture = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'screenshot',
    });
    const captureMs = performance.now() - captureStarted;
    if (!isPngCapture(capture)) throw new Error('agent screenshot did not return a PNG capture');

    const preview = await controller.beginCapture({
      workspaceId: WORKSPACE_ID,
    });
    if (!preview.base64) throw new Error('capture preview was empty');
    const region = await controller.endCapture({
      workspaceId: WORKSPACE_ID,
      rect: { x: 20, y: 20, width: 240, height: 180 },
    });
    if (!region?.base64) throw new Error('capture region was empty');
    await progress('capture-complete');

    const second = await controller.newTab({
      workspaceId: WORKSPACE_ID,
      url: `${TEST_ORIGIN}/heavy`,
    });
    if (second.tabs.length !== 2)
      throw new Error(`expected 2 tabs, received ${second.tabs.length}`);
    await controller.setVisible({ workspaceId: WORKSPACE_ID, visible: false });
    const hiddenText = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'text',
      selector: '#headline',
    });
    assertEqual(hiddenText, 'Heavy native page', 'hidden agent operation');
    await progress('hidden-operation-complete');

    await controller.destroy();
    controller = null;
    const restoredViews: WebContentsView[] = [];
    const restored = new ElectronNativeBrowserController({
      browserSession,
      userDataDir,
      getMainWindow: () => window,
      onChanged: () => undefined,
      createView: () => {
        const view = new WebContentsView({
          webPreferences: {
            partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        });
        restoredViews.push(view);
        return view;
      },
    });
    controller = restored;
    await restored.start();
    const restoredSnapshot = await restored.open({ workspaceId: WORKSPACE_ID });
    if (restoredSnapshot.tabs.length !== 2) {
      throw new Error(`expected 2 restored tabs, received ${restoredSnapshot.tabs.length}`);
    }
    await progress('restore-complete');

    const result = {
      ok: true,
      backend: (await restored.status()).backend,
      realWebContentsViews: views.length + restoredViews.length,
      restoredTabs: restoredSnapshot.tabs.length,
      interactionMs: round(interactionMs),
      captureMs: round(captureMs),
      captureBytes: Buffer.from(capture.base64, 'base64').byteLength,
      regionBytes: Buffer.from(region.base64, 'base64').byteLength,
    };
    await writeFile(smokeResultPath, JSON.stringify(result), 'utf8');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    exitCode = 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeFile(smokeResultPath, JSON.stringify({ ok: false, error: message }), 'utf8').catch(
      () => undefined,
    );
    process.stderr.write(`${message}\n`);
  } finally {
    await controller?.destroy().catch(() => undefined);
    browserSession?.protocol.unhandle('https');
    if (window && !window.isDestroyed()) window.destroy();
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

function testPage(pathname: string): string {
  if (pathname === '/heavy') {
    const rows = Array.from({ length: 2_000 }, (_, index) => `<li>Rendered row ${index}</li>`).join(
      '',
    );
    return `<!doctype html><html><head><title>Heavy</title></head><body><h1 id="headline">Heavy native page</h1><ul>${rows}</ul></body></html>`;
  }
  return `<!doctype html><html><head><title>Form</title><style>body{min-height:6000px;font:16px sans-serif}input{width:420px}</style></head><body><h1>Native form</h1><input id="message"><button id="apply" onclick="result.textContent=message.value">Apply</button><output id="result"></output><div style="height:5500px"></div><p>End of page</p></body></html>`;
}

function isPngCapture(value: unknown): value is { base64: string; mediaType: 'image/png' } {
  if (!value || typeof value !== 'object') return false;
  const capture = value as { base64?: unknown; mediaType?: unknown };
  return (
    capture.mediaType === 'image/png' &&
    typeof capture.base64 === 'string' &&
    capture.base64.length > 0
  );
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
