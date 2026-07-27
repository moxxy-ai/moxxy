import { appendFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { app, BrowserWindow, nativeImage, session, WebContentsView } from 'electron';

import { ElectronNativeBrowserController } from '../electron/main/native-browser-controller.js';

const TEST_ORIGIN = 'https://93.184.216.34';
const WORKSPACE_ID = 'electron-smoke';
const resultPath = process.env.MOXXY_NATIVE_BROWSER_SMOKE_RESULT;
const userDataPath = process.env.MOXXY_NATIVE_BROWSER_SMOKE_USER_DATA;
const smokePhase = process.env.MOXXY_NATIVE_BROWSER_SMOKE_PHASE ?? 'exercise';

if (!resultPath) throw new Error('MOXXY_NATIVE_BROWSER_SMOKE_RESULT is required');
if (!userDataPath) throw new Error('MOXXY_NATIVE_BROWSER_SMOKE_USER_DATA is required');
const smokeResultPath = resultPath;
const smokeUserDataPath = userDataPath;
const execFileAsync = promisify(execFile);
app.setPath('userData', smokeUserDataPath);

void run();

async function run(): Promise<void> {
  const progressPath = `${smokeResultPath}.progress`;
  const progress = async (step: string): Promise<void> => {
    await appendFile(progressPath, `${step}\n`, 'utf8');
  };
  let browserSession: Electron.Session | null = null;
  let window: BrowserWindow | null = null;
  let controller: ElectronNativeBrowserController | null = null;
  let exitCode = 0;

  try {
    await progress('module-loaded');
    await app.whenReady();
    await progress('app-ready');
    const partition = 'persist:moxxy-native-browser-smoke';
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
      if (url.pathname === '/slow-resource') {
        return delay(250).then(() => new Response('ready', { status: 200 }));
      }
      return new Response(testPage(url.pathname), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    await progress('protocol-ready');

    controller = new ElectronNativeBrowserController({
      browserSession,
      userDataDir: smokeUserDataPath,
      downloadsDir: path.join(smokeUserDataPath, 'downloads'),
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

    if (smokePhase === 'verify-restart') {
      const restoredSnapshot = await controller.open({ workspaceId: WORKSPACE_ID });
      if (restoredSnapshot.tabs.length !== 2) {
        throw new Error(`expected 2 restored tabs, received ${restoredSnapshot.tabs.length}`);
      }
      const cookies = await browserSession.cookies.get({
        url: TEST_ORIGIN,
        name: 'moxxy-native-login',
      });
      const persisted = cookies.some((cookie) => cookie.value === 'authenticated');
      if (!persisted) throw new Error('persistent browser login cookie was not restored');
      const result = {
        ok: true,
        backend: (await controller.status()).backend,
        restoredTabs: restoredSnapshot.tabs.length,
        persistentLogin: true,
      };
      await writeFile(smokeResultPath, JSON.stringify(result), 'utf8');
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    const opened = await controller.open({ workspaceId: WORKSPACE_ID });
    await controller.setBounds({
      workspaceId: WORKSPACE_ID,
      rect: { x: 0, y: 0, width: 900, height: 680 },
      rendererViewport: { width: 900, height: 680 },
    });
    const networkIdleStarted = performance.now();
    await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'goto',
      url: `${TEST_ORIGIN}/network-idle`,
      waitUntil: 'networkidle',
      timeoutMs: 5_000,
    });
    const networkIdleMs = performance.now() - networkIdleStarted;
    const networkStatus = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'text',
      target: { type: 'selector', selector: '#network-status' },
    });
    assertEqual(networkStatus, 'ready', 'network-idle resource');
    if (networkIdleMs < 500) {
      throw new Error(`network-idle navigation returned too early after ${round(networkIdleMs)}ms`);
    }
    await controller.navigate({
      workspaceId: WORKSPACE_ID,
      tabId: opened.activeTabId,
      url: `${TEST_ORIGIN}/form`,
    });
    await progress('form-loaded');

    const observation = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'observe',
      mode: 'semantic',
    });
    const observed = parseObservation(observation);
    const messageTarget = observed.nodes.find(
      (node) => node.role === 'textbox' && node.name === 'Message',
    );
    const applyTarget = observed.nodes.find(
      (node) => node.role === 'button' && node.name === 'Apply',
    );
    if (!messageTarget || !applyTarget) {
      throw new Error('semantic observation did not expose the form controls');
    }
    await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'type',
      target: {
        type: 'ref',
        ref: messageTarget.ref,
        revision: observed.revision,
      },
      value: 'Zażółć gęślą jaźń — native input',
    });
    const afterType = parseObservation(
      await controller.executeAgentAction(WORKSPACE_ID, {
        kind: 'observe',
        mode: 'semantic',
      }),
    );
    const currentApplyTarget = afterType.nodes.find(
      (node) => node.role === 'button' && node.name === 'Apply',
    );
    if (!currentApplyTarget) throw new Error('updated observation lost the Apply button');
    await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'click',
      target: {
        type: 'ref',
        ref: currentApplyTarget.ref,
        revision: afterType.revision,
      },
    });
    const renderedText = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'text',
      target: { type: 'selector', selector: '#result' },
    });
    assertEqual(renderedText, 'Zażółć gęślą jaźń — native input', 'shared form result');
    const trustedInput = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'text',
      target: { type: 'selector', selector: '#input-trusted' },
    });
    const trustedClick = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'text',
      target: { type: 'selector', selector: '#click-trusted' },
    });
    assertEqual(trustedInput, 'true', 'trusted native input event');
    assertEqual(trustedClick, 'true', 'trusted native click event');
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

    const fullPageCapture = await controller.executeAgentAction(WORKSPACE_ID, {
      kind: 'screenshot',
      fullPage: true,
    });
    if (!isPngCapture(fullPageCapture)) {
      throw new Error('agent full-page screenshot did not return a PNG capture');
    }
    const fullPageSize = nativeImage
      .createFromBuffer(Buffer.from(fullPageCapture.base64, 'base64'))
      .getSize();
    if (fullPageSize.height < 6_000) {
      throw new Error(`full-page screenshot was clipped to ${fullPageSize.height}px`);
    }

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
      target: { type: 'selector', selector: '#headline' },
    });
    assertEqual(hiddenText, 'Heavy native page', 'hidden agent operation');
    await progress('hidden-operation-complete');

    await controller.setVisible({ workspaceId: WORKSPACE_ID, visible: true });
    const heavyView = views[1];
    if (!heavyView) throw new Error('heavy-page WebContentsView was not created');
    const nativeMedianCpu = await measureMedianAppCpu();
    const legacyMedianCpu = await measureMedianAppCpu(async () => {
      const image = await heavyView.webContents.capturePage();
      image.toJPEG(72).toString('base64');
    });
    const cpuReductionPercent =
      legacyMedianCpu > 0 ? ((legacyMedianCpu - nativeMedianCpu) / legacyMedianCpu) * 100 : 0;
    if (cpuReductionPercent < 70) {
      throw new Error(
        `native browser CPU reduction was ${round(cpuReductionPercent)}%, expected at least 70% ` +
          `(native=${round(nativeMedianCpu)}, legacy=${round(legacyMedianCpu)})`,
      );
    }
    await assertNoHeadlessShellDescendant();
    await progress('performance-verified');

    await browserSession.cookies.set({
      url: TEST_ORIGIN,
      name: 'moxxy-native-login',
      value: 'authenticated',
      secure: true,
      httpOnly: true,
      expirationDate: Date.now() / 1_000 + 3_600,
    });
    await browserSession.flushStorageData();
    await progress('persistence-seeded');

    const result = {
      ok: true,
      backend: (await controller.status()).backend,
      realWebContentsViews: views.length,
      tabsBeforeRestart: second.tabs.length,
      semanticControls: observed.nodes.length,
      interactionMs: round(interactionMs),
      networkIdleMs: round(networkIdleMs),
      captureMs: round(captureMs),
      captureBytes: Buffer.from(capture.base64, 'base64').byteLength,
      fullPageHeight: fullPageSize.height,
      regionBytes: Buffer.from(region.base64, 'base64').byteLength,
      nativeMedianCpu: round(nativeMedianCpu),
      legacyMedianCpu: round(legacyMedianCpu),
      cpuReductionPercent: round(cpuReductionPercent),
      headlessShellProcesses: 0,
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
    app.exit(exitCode);
  }
}

function testPage(pathname: string): string {
  if (pathname === '/network-idle') {
    return `<!doctype html><html><head><title>Network idle</title></head><body><output id="network-status">waiting</output><script>fetch('/slow-resource').then(response => response.text()).then(value => { document.querySelector('#network-status').textContent = value; });</script></body></html>`;
  }
  if (pathname === '/heavy') {
    const rows = Array.from({ length: 2_000 }, (_, index) => `<li>Rendered row ${index}</li>`).join(
      '',
    );
    return `<!doctype html><html><head><title>Heavy</title></head><body><h1 id="headline">Heavy native page</h1><ul>${rows}</ul></body></html>`;
  }
  return `<!doctype html><html><head><title>Form</title><style>body{min-height:6000px;font:16px sans-serif}input{width:420px}</style></head><body><h1>Native form</h1><label for="message">Message</label><input id="message"><button id="apply">Apply</button><output id="result"></output><output id="input-trusted"></output><output id="click-trusted"></output><div style="height:5500px"></div><p>End of page</p><script>message.addEventListener('input', event => { document.querySelector('#input-trusted').textContent = String(event.isTrusted); }); apply.addEventListener('click', event => { result.textContent = message.value; document.querySelector('#click-trusted').textContent = String(event.isTrusted); });</script></body></html>`;
}

function parseObservation(value: unknown): {
  readonly revision: string;
  readonly nodes: ReadonlyArray<{ readonly ref: string; readonly role: string; readonly name: string }>;
} {
  if (!value || typeof value !== 'object') throw new Error('semantic observation was not an object');
  const observation = value as { revision?: unknown; nodes?: unknown };
  if (typeof observation.revision !== 'string' || !Array.isArray(observation.nodes)) {
    throw new Error('semantic observation was incomplete');
  }
  const nodes = observation.nodes.filter(
    (node): node is { ref: string; role: string; name: string } =>
      Boolean(
        node &&
          typeof node === 'object' &&
          typeof (node as { ref?: unknown }).ref === 'string' &&
          typeof (node as { role?: unknown }).role === 'string' &&
          typeof (node as { name?: unknown }).name === 'string',
      ),
  );
  return { revision: observation.revision, nodes };
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

async function measureMedianAppCpu(work?: () => Promise<void>): Promise<number> {
  app.getAppMetrics();
  const samples: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    const deadline = Date.now() + 400;
    if (work) {
      while (Date.now() < deadline) {
        await work();
        const remaining = deadline - Date.now();
        if (remaining > 0) await delay(Math.min(100, remaining));
      }
    } else {
      await delay(400);
    }
    const cpu = app
      .getAppMetrics()
      .reduce((total, metric) => total + metric.cpu.percentCPUUsage, 0);
    samples.push(cpu);
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)] ?? 0;
}

async function assertNoHeadlessShellDescendant(): Promise<void> {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,comm=']);
  const rows = stdout
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter((row): row is RegExpMatchArray => Boolean(row));
  const descendants = new Set<number>([process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const pid = Number(row[1]);
      const parent = Number(row[2]);
      if (descendants.has(parent) && !descendants.has(pid)) {
        descendants.add(pid);
        changed = true;
      }
    }
  }
  const headless = rows.filter(
    (row) => descendants.has(Number(row[1])) && row[3]?.includes('chrome-headless-shell'),
  );
  if (headless.length > 0) {
    throw new Error(`native browser spawned chrome-headless-shell: ${headless.join(', ')}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
