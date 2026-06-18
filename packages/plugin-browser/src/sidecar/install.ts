/**
 * Playwright lifecycle: import, launch, and one-shot auto-install of the
 * per-browser binary. Keeps the dispatch layer free of node:child_process
 * + Playwright-import noise.
 */

import { spawn } from 'node:child_process';
import { assertPublicUrl } from '../ssrf-guard.js';
import { SidecarError } from './types.js';
import type { BrowserKind, BrowserType, PageHandle, PlaywrightHandle } from './types.js';

export interface LaunchResult {
  handle: PlaywrightHandle;
  /** Set when the browser binary was auto-downloaded during this launch. */
  installNotice: string | null;
}

export async function importPlaywright(): Promise<{
  chromium: BrowserType;
  firefox: BrowserType;
  webkit: BrowserType;
}> {
  try {
    return (await import('playwright')) as never;
  } catch (err) {
    const underlying = err instanceof Error ? err.message : String(err);
    // Distinguish "the npm package isn't installed" (recoverable — the surface
    // can offer a one-click install, see `installPlaywrightPackage`) from any
    // other import failure. The `kind` rides the JSON-RPC reply so the browser
    // surface shows an "Install" affordance instead of a dead-end error.
    throw new SidecarError(
      `Playwright is not installed. Run \`pnpm add playwright\` (or \`npm i playwright\`) and then \`npx playwright install\` in the moxxy install dir.\n` +
        `Underlying: ${underlying}`,
      isModuleNotFound(underlying) ? 'needs-install' : 'init',
    );
  }
}

/** True when an import failure is "the `playwright` package can't be found"
 *  (vs. a load/runtime error inside an installed package). */
function isModuleNotFound(message: string): boolean {
  return (
    /cannot find (package|module) ['"]?playwright/i.test(message) ||
    /ERR_MODULE_NOT_FOUND/i.test(message) ||
    /failed to resolve ['"]?playwright/i.test(message)
  );
}

export interface InstallPlaywrightOptions {
  /** Directory whose `node_modules` should receive `playwright` — the CLI
   *  install root (e.g. `<userData>/cli`). `npm` runs with this as its cwd. */
  readonly rootDir: string;
  /** Which browser engine binary to download after the npm package lands. */
  readonly browser?: BrowserKind;
  /** Per-line progress (npm/npx stdout+stderr) for streaming to the UI. */
  readonly onProgress?: (line: string) => void;
  readonly signal?: AbortSignal;
}

/**
 * Install the `playwright` npm package into `rootDir`, then download the browser
 * engine binary — the two halves the desktop browser surface needs. Driven by
 * the surface AFTER the user consents (the download is ~200MB). Streams progress
 * via `onProgress`; resolves on success, rejects with the failing step's output.
 *
 * Lives next to {@link importPlaywright} (which reports the `needs-install` that
 * triggers this) but is invoked in the RUNNER process — `rootDir`'s node_modules
 * is the one the sidecar later imports `playwright` from.
 */
export async function installPlaywrightPackage(opts: InstallPlaywrightOptions): Promise<void> {
  const which = opts.browser ?? 'chromium';
  opts.onProgress?.(`Installing the playwright npm package into ${opts.rootDir}…`);
  await runProcess('npm', ['install', '--no-fund', '--no-audit', 'playwright'], opts);
  opts.onProgress?.(`Downloading the ${which} browser engine (~150MB, one-time)…`);
  await runProcess('npx', ['playwright', 'install', which], opts);
  opts.onProgress?.('Playwright installed.');
}

/** Spawn a child, forward its output to `onProgress`, resolve on exit-0. */
function runProcess(cmd: string, args: string[], opts: InstallPlaywrightOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Error('install aborted'));
    const child = spawn(cmd, args, { cwd: opts.rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const onChunk = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) if (line.trim()) opts.onProgress?.(line);
      tail = (tail + text).slice(-4000);
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    const onAbort = (): void => {
      child.kill();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.once('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else
        reject(
          new Error(`\`${cmd} ${args.join(' ')}\` failed (exit ${code}): ${tail.trim() || '(no output)'}`),
        );
    });
  });
}

/**
 * Try to launch the browser. If the binary isn't downloaded yet
 * (Playwright distinguishes the npm install from the per-browser
 * binary download), run `npx playwright install <which>` once and
 * retry. The install can take 30s–2min on the first run depending on
 * connection; we surface progress on stderr (parent forwards to the
 * logger) and return a one-shot notice for the first tool response.
 */
export async function launchWithAutoInstall(
  browserType: BrowserType,
  which: BrowserKind,
  headless: boolean,
): Promise<LaunchResult> {
  try {
    return { handle: await launchOnce(browserType, headless), installNotice: null };
  } catch (err) {
    if (!isMissingBrowserError(err)) throw err;
    process.stderr.write(
      `moxxy-browser: ${which} binary missing, running \`npx playwright install ${which}\` ` +
        `(one-time, ~150MB). This may take a minute…\n`,
    );
    try {
      await runPlaywrightInstall(which);
    } catch (installErr) {
      const msg = installErr instanceof Error ? installErr.message : String(installErr);
      throw new SidecarError(
        `Playwright browser auto-install failed: ${msg}. ` +
          `Run \`npx playwright install ${which}\` manually in the moxxy dir.`,
        'init',
      );
    }
    process.stderr.write(`moxxy-browser: install complete, retrying launch\n`);
    return {
      handle: await launchOnce(browserType, headless),
      installNotice: `Auto-installed Playwright ${which} browser (~150MB, one-time).`,
    };
  }
}

async function launchOnce(browserType: BrowserType, headless: boolean): Promise<PlaywrightHandle> {
  const browser = await browserType.launch({ headless });
  // deviceScaleFactor: 2 so the live-view / region screenshots are captured at
  // Retina density — a 1× capture upscaled into a HiDPI pane is what made the
  // surface look blurry. Costs ~2× the screenshot bytes; worth it for crisp text.
  const context = (await browser.newContext({ deviceScaleFactor: 2 })) as PlaywrightHandle['context'];
  await installNavigationSsrfGuard(context);
  const page = (await context.newPage()) as unknown as PageHandle;
  return { browser, context, page };
}

/**
 * Block navigations to private/loopback origins for the lifetime of the
 * context. The goto RPC is validated in the parent AND in dispatch, but a
 * page reached via a legitimate public goto can then redirect or
 * script-navigate itself to e.g. http://169.254.169.254/ — those navigations
 * never pass through the RPC layer, so we intercept them here. Navigation
 * requests (top-level + iframes, which covers HTTP redirect hops too) go
 * through the same `assertPublicUrl` guard as web_fetch; everything else is
 * passed through untouched so ordinary page loads don't pay a DNS round-trip
 * per subresource.
 *
 * Residual risk (also stated in the browser_session tool description):
 * SUBRESOURCE requests (img/fetch/script) from a loaded page are NOT
 * filtered. The browser's same-origin policy stops the page reading those
 * responses, but blind request side effects against internal services remain
 * possible. Filtering every request was judged disproportionate for now.
 */
async function installNavigationSsrfGuard(context: PlaywrightHandle['context']): Promise<void> {
  if (typeof context.route !== 'function') return; // loose projection: tolerate stubs without route()
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!request.isNavigationRequest()) return route.continue();
    try {
      await assertPublicUrl(request.url(), 'browser_session navigation');
    } catch {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
}

function isMissingBrowserError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Playwright's "Executable doesn't exist at …" launch error fires
  // when the npm package is installed but the per-browser binary
  // hasn't been downloaded. The message stays stable across versions.
  return /Executable doesn'?t exist at/i.test(err.message);
}

/**
 * Run `npx playwright install <which>` and stream its output to the
 * sidecar's stderr so the operator can watch progress. Resolves on
 * exit-0; rejects with the tail of stderr otherwise.
 */
function runPlaywrightInstall(which: BrowserKind): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['playwright', 'install', which], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderrTail = '';
    child.stdout.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderrTail += chunk.toString('utf8');
      if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
    });
    child.once('error', (err) => reject(err));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}: ${stderrTail.trim() || '(no stderr)'}`));
    });
  });
}
