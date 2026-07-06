import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MoxxyError, assertDefined, defineTool, z } from '@moxxy/sdk';
import { assertPublicUrl, SsrfBlockedError } from './ssrf-guard.js';

/**
 * Heavy-tier browser: spawns the Playwright sidecar over stdio JSON-RPC and
 * drives it through one tool. The sidecar owns one browser context per
 * process; calls within a session share the same page (back/forward/click
 * sequences work).
 *
 * Sidecar lifecycle: lazy-spawned on first invocation, kept alive for the
 * process lifetime, closed via `Session.close` (an `onShutdown` hook is
 * registered by the plugin). Playwright is an optional peer dep — sidecar
 * returns a clear error if it's not installed.
 */

type Action =
  | { kind: 'goto'; url: string; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeoutMs?: number }
  | { kind: 'click'; selector: string; timeoutMs?: number }
  | { kind: 'fill'; selector: string; value: string; timeoutMs?: number }
  | { kind: 'text'; selector?: string }
  | { kind: 'html' }
  | { kind: 'screenshot'; fullPage?: boolean }
  | { kind: 'eval'; expression: string }
  | { kind: 'url' };

const actionSchema: z.ZodType<Action> = z.union([
  z.object({
    kind: z.literal('goto'),
    // `z.string().url()` accepts file:// and javascript: URLs, which would be
    // forwarded verbatim to Playwright `page.goto`. This refine is only a fast
    // schema-level scheme check; the full SSRF guard (loopback/private/
    // link-local/metadata IPs, DNS resolution — same `assertPublicUrl` as
    // web_fetch) runs in the handler before the RPC AND again inside the
    // sidecar's goto dispatch.
    url: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'only http(s) URLs allowed'),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
  }),
  z.object({
    kind: z.literal('click'),
    selector: z.string().min(1),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
  }),
  z.object({
    kind: z.literal('fill'),
    selector: z.string().min(1),
    value: z.string(),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
  }),
  z.object({ kind: z.literal('text'), selector: z.string().optional() }),
  z.object({ kind: z.literal('html') }),
  z.object({ kind: z.literal('screenshot'), fullPage: z.boolean().optional() }),
  z.object({ kind: z.literal('eval'), expression: z.string().min(1) }),
  z.object({ kind: z.literal('url') }),
]);

export interface BrowserSessionDeps {
  /**
   * Override the sidecar script path. Default: resolved next to this file
   * (i.e., the `dist/sidecar.js` shipped in the same package).
   */
  readonly sidecarPath?: string;
  /**
   * Spawn override (test seam). When set, the tool will call this instead
   * of `child_process.spawn` — useful for fake sidecars.
   */
  readonly spawnFn?: (sidecarPath: string) => SidecarStream;
  /**
   * Per-call timeout override (test seam). Defaults to
   * {@link DEFAULT_CALL_TIMEOUT_MS}. A hung sidecar op is rejected after this.
   */
  readonly callTimeoutMs?: number;
}

export interface SidecarStream {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr?: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null) => void): void;
}

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (err: Error) => void;
}

/**
 * Parent-side per-call ceiling. A wedged sidecar op (an `eval` running
 * `while(true){}`, a screenshot on a hung renderer) never replies and the
 * sidecar process stays alive, so without a parent timeout the pending entry —
 * and every request queued behind it — would hang forever (the surface poll's
 * inFlight guard then latches and the live view silently freezes). 90s is
 * comfortably above the longest legitimate in-sidecar timeout (goto's 120s is
 * the only one above, and it is bounded inside the sidecar; surface frame polls
 * are sub-second). Exceeding it rejects THIS call only — the shared sidecar and
 * any healthy concurrent calls are untouched (a late reply is ignored).
 */
const DEFAULT_CALL_TIMEOUT_MS = 150_000;
/** Hard ceiling on queued requests so a wedged head can't let the parent pile
 *  up unbounded pending entries (e.g. 3/s surface polls behind a stuck op). */
const MAX_PENDING = 256;
/**
 * Cap the parent's hand-rolled stdout line buffer. A sidecar (or a process
 * spoofing the JSON-RPC channel) that emits a very long line with no newline
 * would otherwise grow this string without limit, copying it on every chunk
 * (O(n^2) + unbounded memory in the runner). 96MB comfortably fits the largest
 * legitimate single line — a base64 full-page PNG at deviceScaleFactor 2 — while
 * still bounding a runaway. On overflow we drop the buffer and log a protocol
 * error rather than OOM the runner.
 */
const MAX_STDOUT_BUFFER = 96 * 1024 * 1024;
/** stderr is human-readable status only — a much smaller cap is plenty. */
const MAX_STDERR_BUFFER = 1 * 1024 * 1024;

/**
 * Coerce a sidecar reply into an object so we can attach `notice`.
 * Wraps primitives + strings; pass-through for objects.
 */
function wrapResult(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value };
}

class Sidecar {
  private child: SidecarStream | null = null;
  private buffer = '';
  private readonly pending = new Map<string, PendingCall>();
  private startError: Error | null = null;
  /** Listeners for sidecar stderr lines — used by callers that want
   *  install-progress feedback in their own logger/UI. A Set (not a single
   *  slot) so concurrent browser_session calls don't clobber each other. */
  private readonly stderrListeners = new Set<(line: string) => void>();
  /** Last few sidecar stderr lines, kept so the `exit` handler can put the
   *  ACTUAL failure (e.g. "Cannot find module …" or Playwright's "Executable
   *  doesn't exist, run npx playwright install") into the error instead of a
   *  bare `code=1` the caller can't act on. */
  private readonly recentStderr: string[] = [];

  constructor(
    private readonly sidecarPath: string,
    private readonly spawnFn: (path: string) => SidecarStream,
    private readonly callTimeoutMs: number = DEFAULT_CALL_TIMEOUT_MS,
  ) {}

  /** Subscribe to sidecar stderr lines. Returns an unsubscribe function. */
  onStderr(fn: (line: string) => void): () => void {
    this.stderrListeners.add(fn);
    return () => this.stderrListeners.delete(fn);
  }

  async ensure(): Promise<void> {
    if (this.child) return;
    if (this.startError) throw this.startError;
    try {
      this.child = this.spawnFn(this.sidecarPath);
    } catch (err) {
      this.startError = err instanceof Error ? err : new Error(String(err));
      throw this.startError;
    }
    this.child.stdout.setEncoding?.('utf8');
    this.child.stdout.on('data', (chunk: string | Buffer) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        if (line.trim()) this.handleLine(line);
      }
      // A single line with no newline that exceeds the cap is malformed/hostile
      // protocol output. Drop it (and any partial accumulation) rather than let
      // the runner grow unbounded; the in-flight call that expected its reply
      // will hit its per-call timeout.
      if (this.buffer.length > MAX_STDOUT_BUFFER) {
        this.recentStderr.push(
          `[moxxy] dropped ${this.buffer.length} bytes of un-delimited sidecar stdout (> ${MAX_STDOUT_BUFFER} cap)`,
        );
        this.buffer = '';
      }
    });
    // Forward sidecar stderr line-by-line. The sidecar uses stderr
    // for install progress ("downloading chromium…") and other
    // human-readable status; callers wire `onStderr` to surface it.
    let stderrBuf = '';
    const stderr = this.child.stderr;
    if (stderr) stderr.on('data', (chunk: string | Buffer) => {
      stderrBuf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl: number;
      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, nl);
        stderrBuf = stderrBuf.slice(nl + 1);
        if (line.trim()) {
          this.recentStderr.push(line);
          if (this.recentStderr.length > 24) this.recentStderr.shift();
          for (const fn of this.stderrListeners) fn(line);
        }
      }
      // Bound a runaway no-newline stderr stream too (it feeds the error tail,
      // so keep only the most recent bytes rather than drop wholesale).
      if (stderrBuf.length > MAX_STDERR_BUFFER) stderrBuf = stderrBuf.slice(-MAX_STDERR_BUFFER);
    });
    this.child.once('exit', (code) => {
      // Surface whatever the sidecar printed before dying — that's where the
      // real reason lives (missing module, Playwright not installed, etc.).
      const tail = this.recentStderr.slice(-8).join('\n').trim();
      const err = new MoxxyError({
        code: 'INTERNAL',
        message:
          `browser sidecar exited unexpectedly (code=${code ?? 'null'})` +
          (tail ? `:\n${tail}` : ' (no stderr captured)'),
      });
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
      this.child = null;
    });
  }

  private handleLine(line: string): void {
    let reply: {
      id?: string;
      ok?: boolean;
      result?: unknown;
      error?: { message: string; kind?: string };
      notice?: string;
    };
    try {
      reply = JSON.parse(line);
    } catch {
      return; // ignore garbage
    }
    const p = reply.id ? this.pending.get(reply.id) : undefined;
    if (!p || !reply.id) return;
    this.pending.delete(reply.id);
    if (reply.ok) {
      // Attach the optional sidecar-supplied notice (e.g. "Auto-installed
      // Chromium") so the tool's caller can surface it to the user. Wrap
      // primitive results in `{ result, notice }` so the shape stays
      // useful regardless of what the original call returned.
      if (reply.notice) {
        p.resolve({ ...wrapResult(reply.result), notice: reply.notice });
      } else {
        p.resolve(reply.result);
      }
    } else {
      // Carry the sidecar's typed `kind` on the rejected error so the surface
      // can tell "playwright not installed" (offer an Install button) apart from
      // a generic failure. MoxxyError doesn't model it, so attach it as a tag.
      const err = new MoxxyError({ code: 'INTERNAL', message: reply.error?.message ?? 'sidecar error' });
      if (reply.error?.kind) (err as MoxxyError & { sidecarKind?: string }).sidecarKind = reply.error.kind;
      p.reject(err);
    }
  }

  async call(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    await this.ensure();
    if (!this.child) throw new MoxxyError({ code: 'INTERNAL', message: 'sidecar not running' });
    if (signal?.aborted) throw new MoxxyError({ code: 'NETWORK_ABORTED', message: 'browser_session aborted' });
    // Bound the pending map: a wedged sidecar head + chatty caller (surface
    // polls) must not let the parent accumulate pending entries without limit.
    if (this.pending.size >= MAX_PENDING) {
      throw new MoxxyError({
        code: 'INTERNAL',
        message: `browser sidecar busy (${this.pending.size} requests in flight)`,
      });
    }
    const id = randomUUID();
    const req = { id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      // Per-call timeout: a sidecar op that never replies (hung eval/screenshot)
      // would otherwise strand this pending entry — and the serial queue behind
      // it — indefinitely. On expiry, drop the entry and reject THIS call only;
      // a late reply is then ignored (id no longer in `pending`).
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          cleanup();
          reject(
            new MoxxyError({
              code: 'INTERNAL',
              message: `browser_session "${method}" timed out after ${this.callTimeoutMs}ms`,
            }),
          );
        }
      }, this.callTimeoutMs);
      timer.unref?.();
      // Abort cancels ONLY this pending call (rejects its promise); it does
      // NOT kill the shared singleton sidecar, which other concurrent calls
      // depend on. A late reply for this id is then ignored (not in `pending`).
      const onAbort = (): void => {
        if (this.pending.delete(id)) {
          cleanup();
          reject(new MoxxyError({ code: 'NETWORK_ABORTED', message: 'browser_session aborted' }));
        }
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.pending.set(id, {
        resolve: (v) => {
          cleanup();
          resolve(v);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const child = this.child;
        assertDefined(child, 'sidecar child running (guarded via `if (!this.child) throw` at call() entry)');
        child.stdin.write(JSON.stringify(req) + '\n');
      } catch (err) {
        this.pending.delete(id);
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async close(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    try {
      await this.call('close');
    } catch {
      /* ignore */
    }
    // Wait briefly for a clean exit, escalating SIGTERM → SIGKILL so a wedged
    // sidecar (or a detached Chromium ignoring SIGTERM) can't survive as an
    // orphan after session shutdown.
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve();
      };
      // Arm the SIGKILL escalation BEFORE killing, so a synchronous `exit`
      // (e.g. the test fake) finds `timer` already assigned when `done` runs.
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        done();
      }, 2000);
      timer.unref?.();
      child.once('exit', () => done());
      try {
        child.kill('SIGTERM');
      } catch {
        done();
      }
    });
    this.child = null;
  }
}

/** Module-level singleton: one sidecar per process. */
let SIDECAR_INSTANCE: Sidecar | null = null;
/** The deps the live singleton was created with, so a later caller passing
 *  DIFFERENT deps (silently ignored) is made visible rather than a footgun. */
let SIDECAR_DEPS: BrowserSessionDeps | undefined;

/**
 * Resolve the shared, process-wide sidecar, creating it on first use.
 *
 * IMPORTANT: `deps` (sidecarPath / spawnFn) are honored ONLY on the FIRST call
 * that creates the singleton. The tool handler and the surface each call this
 * with their own `deps`; whichever runs first wins, and any later caller's
 * `deps` are silently ignored — both production builds pass the same opts so
 * they agree. A test that wants a distinct spawn override must therefore call
 * {@link closeBrowserSidecar} first to reset the singleton, otherwise it will
 * bind against whatever spawn was installed by an earlier call.
 *
 * When a later caller passes deps that DIFFER from the live singleton's we emit
 * a warning (the binding stays the original's) so the silent-ignore is visible
 * — the proper fix is a per-owner registry, tracked in needsFollowup.
 */
function getSidecar(deps?: BrowserSessionDeps): Sidecar {
  if (SIDECAR_INSTANCE) {
    if (
      deps &&
      (deps.sidecarPath !== SIDECAR_DEPS?.sidecarPath || deps.spawnFn !== SIDECAR_DEPS?.spawnFn)
    ) {
      console.warn(
        '[moxxy/plugin-browser] getSidecar called with deps that differ from the live singleton; ' +
          'they are ignored. Call closeBrowserSidecar() first to rebind.',
      );
    }
    return SIDECAR_INSTANCE;
  }
  const sidecarPath = deps?.sidecarPath ?? defaultSidecarPath();
  const spawnFn = deps?.spawnFn ?? defaultSpawn;
  SIDECAR_INSTANCE = new Sidecar(sidecarPath, spawnFn, deps?.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
  SIDECAR_DEPS = deps;
  return SIDECAR_INSTANCE;
}

/** Resolve to the sidecar JS file shipped alongside this module. */
function defaultSidecarPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'sidecar.js');
}

/** The sidecar-supplied error tag (see {@link Sidecar.handleLine}); 'needs-install'
 *  means the `playwright` npm package isn't present yet. */
export function sidecarErrorKind(err: unknown): string | undefined {
  return (err as { sidecarKind?: string } | null)?.sidecarKind;
}

/**
 * The directory whose `node_modules` the sidecar imports `playwright` from — the
 * CLI install root (e.g. `<userData>/cli`). Found by walking up from the sidecar
 * file to the nearest `node_modules` ancestor and returning ITS parent. Falls
 * back to the sidecar's own dir if no `node_modules` is on the path (dev/tests).
 */
export function resolveBrowserInstallRoot(deps?: BrowserSessionDeps): string {
  const start = deps?.sidecarPath ?? defaultSidecarPath();
  let dir = path.dirname(start);
  for (let i = 0; i < 12; i += 1) {
    if (path.basename(dir) === 'node_modules') return path.dirname(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(start);
}

function defaultSpawn(scriptPath: string): SidecarStream {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return child;
}

export function buildBrowserSessionTool(deps?: BrowserSessionDeps) {
  return defineTool({
    name: 'browser_session',
    description:
      'Drive a real browser (Playwright). Use for pages that need JS execution, clicks, form fills, or screenshots. For simple GETs prefer web_fetch (no extra deps). Calls within a session share one page. ' +
      'Navigation is restricted to public http(s) origins: goto URLs and top-level/iframe navigations (including redirects) to loopback, private (RFC-1918), link-local/metadata, or CGNAT addresses are blocked. ' +
      'The `eval` action runs ARBITRARY JavaScript in the loaded page context (full DOM/cookie/localStorage access, can drive same-origin requests) — set MOXXY_BROWSER_DISABLE_EVAL=1 to disable in-page scripting while keeping navigation/click/fill. ' +
      'Residual risk: by default subresource requests (img/fetch/script) issued by a loaded page are NOT filtered, so a hostile page can still send blind requests at internal services; set MOXXY_BROWSER_FILTER_SUBRESOURCES=1 to filter those too.',
    inputSchema: z.object({
      action: actionSchema,
    }),
    permission: { action: 'prompt' },
    // Honest capability surface: browser_session spawns the Playwright sidecar
    // (a child process) which drives a real browser to arbitrary hosts and may
    // auto-install browser binaries into Playwright's cache on first use. The
    // `eval` action additionally executes ARBITRARY in-page JavaScript (DOM /
    // cookie / localStorage access of the loaded site) — gate it with
    // MOXXY_BROWSER_DISABLE_EVAL=1 to keep navigation/click/fill but forbid
    // scripting. Modeled on the Bash tool's declaration — these caps are
    // advisory until @moxxy/plugin-security is enabled, at which point an
    // isolator enforces them.
    isolation: {
      capabilities: {
        subprocess: true,
        net: { mode: 'any' },
        // Sidecar may download/unpack browser binaries into the Playwright cache.
        fs: { read: ['$cwd/**', '/tmp/**'], write: ['$cwd/**', '/tmp/**'] },
        env: ['PATH', 'HOME', 'USER', 'PLAYWRIGHT_BROWSERS_PATH'],
        timeMs: 120_000,
      },
    },
    async handler({ action }, ctx) {
      const sidecar = getSidecar(deps);
      // Surface install-progress lines (and any other sidecar status writes)
      // through this call's logger — visible in verbose mode and the event log
      // ("downloading chromium…") instead of an apparently-hung turn. onStderr
      // now supports concurrent subscribers and returns an unsubscribe.
      const offStderr = sidecar.onStderr((line) => ctx.logger.info('browser_session', { line }));
      // Per-call abort: pass ctx.signal so an abort cancels THIS call's RPC,
      // rather than calling sidecar.close() which would tear down the shared
      // singleton (and every other concurrent browser_session) on the bus.
      const call = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
        sidecar.call(method, params, ctx.signal);
      try {
        switch (action.kind) {
          case 'goto':
            // Parent-side SSRF guard — the same assertPublicUrl web_fetch uses
            // (loopback/private/link-local/metadata blocked, hostname resolved).
            // The sidecar re-checks in its goto dispatch (defence in depth, it
            // is a separate process) and intercepts in-page navigations.
            try {
              // fail-closed on the browser path: Chromium resolves names itself,
              // so an unresolvable-here name must not be handed to the sidecar.
              await assertPublicUrl(action.url, 'browser_session', { failClosed: true });
            } catch (err) {
              if (err instanceof SsrfBlockedError) {
                throw new MoxxyError({ code: 'INTERNAL', message: err.message });
              }
              throw err;
            }
            return await call('goto', {
              url: action.url,
              waitUntil: action.waitUntil,
              timeoutMs: action.timeoutMs,
            });
          case 'click':
            return await call('click', { selector: action.selector, timeoutMs: action.timeoutMs });
          case 'fill':
            return await call('fill', {
              selector: action.selector,
              value: action.value,
              timeoutMs: action.timeoutMs,
            });
          case 'text':
            return await call('text', { selector: action.selector });
          case 'html':
            return await call('html');
          case 'screenshot':
            return await call('screenshot', { fullPage: action.fullPage });
          case 'eval':
            // Deployment opt-out: in-page scripting can exfiltrate the loaded
            // site's DOM/cookies/storage, so allow disabling it while keeping
            // navigation/click/fill.
            if (process.env.MOXXY_BROWSER_DISABLE_EVAL === '1') {
              throw new MoxxyError({
                code: 'INTERNAL',
                message: 'browser_session eval is disabled (MOXXY_BROWSER_DISABLE_EVAL=1)',
              });
            }
            return await call('eval', { expression: action.expression });
          case 'url':
            return await call('url');
        }
      } finally {
        offStderr();
      }
    },
  });
}

/**
 * Call a method on the shared sidecar (used by the browser SURFACE so it drives
 * the SAME page the `browser_session` tool does — agent + user share one page).
 */
export function browserSidecarCall(
  method: string,
  params: Record<string, unknown> = {},
  deps?: BrowserSessionDeps,
): Promise<unknown> {
  return getSidecar(deps).call(method, params);
}

/** Closes the singleton sidecar — wired to plugin `onShutdown`. */
export async function closeBrowserSidecar(): Promise<void> {
  if (SIDECAR_INSTANCE) {
    await SIDECAR_INSTANCE.close();
    SIDECAR_INSTANCE = null;
    SIDECAR_DEPS = undefined;
  }
}
