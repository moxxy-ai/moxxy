import { Worker } from 'node:worker_threads';
import { definePlugin, type Isolator, type Plugin } from '@moxxy/sdk';
import {
  checkAllCaps,
  handleBrokerRequest,
  LOADER_HOOK_SOURCE,
  type BrokerRequest,
} from '@moxxy/plugin-security';

/**
 * Worker entry code, inlined as a string and run via
 * `new Worker(SHIM_SOURCE, { eval: true, workerData })`.
 *
 * The shim:
 *  1. Imports the tool's handler module and named export.
 *  2. Builds a synthetic `ToolContext` with capability-mediated
 *     `fs` + `fetch` proxies. Each call posts a `broker-request` to
 *     the parent, awaits a `broker-response` with a matching id, and
 *     resolves the in-worker Promise.
 *  3. Calls the handler with (input, ctx).
 *  4. Posts a `result` message to the parent with success or failure.
 *
 * RPC message shapes (see `broker.ts`):
 *  - worker → parent: { type: 'broker-request', id, op, args }
 *  - parent → worker: { type: 'broker-response', id, ok, value/error... }
 *  - worker → parent (terminal): { type: 'result', ok, value/error... }
 *
 * Inlined as a string for the reasons documented in Phase 2 first cut:
 * worker_threads file form requires the .js to physically exist at a
 * known URL, which is asymmetric across published / src-mode runs.
 */
const SHIM_SOURCE = `
const { parentPort, workerData } = await import('node:worker_threads');
const { moduleUrl, exportName, input, syntheticCtx, loaderUrl } = workerData;
// Register the import-blocking loader BEFORE the handler module
// loads. Subsequent imports (including the handler's transitive
// imports) go through this hook; node:fs / node:child_process / raw
// net throw at resolution time. The shim's own static needs
// (node:worker_threads, node:module) ran before this line, so they
// aren't affected.
const { register } = await import('node:module');
register(loaderUrl, import.meta.url);

// RPC client state
let nextId = 1;
const pending = new Map();

// Cooperative-cancel signal handed to the handler as ctx.signal. The
// parent posts { type: 'abort' } on timeout / host-abort (before the
// hard worker.terminate()), giving a well-behaved handler that wired
// ctx.signal into fetch / long loops a chance to bail out and flush.
const abortController = new AbortController();

parentPort.on('message', (msg) => {
  if (!msg) return;
  if (msg.type === 'abort') {
    abortController.abort(
      new DOMException('aborted by isolator', 'AbortError'),
    );
    return;
  }
  if (msg.type === 'broker-response') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) {
      p.resolve(msg.value);
    } else {
      const e = new Error(msg.errorMessage);
      e.name = msg.errorName || 'Error';
      p.reject(e);
    }
  }
});

function rpc(op, args) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    parentPort.postMessage({ type: 'broker-request', id, op, args });
  });
}

const broker = {
  fs: {
    readFile: (filePath, opts) => rpc('fs.readFile', [filePath, opts || {}]),
    writeFile: (filePath, data) => rpc('fs.writeFile', [filePath, data]),
    readdir: (dirPath) => rpc('fs.readdir', [dirPath]),
    stat: (filePath) => rpc('fs.stat', [filePath]),
  },
  fetch: (url, init) => rpc('fetch', [url, init || {}]),
  exec: (cmd, args, opts) => rpc('exec', [cmd, args || [], opts || {}]),
};

try {
  const mod = await import(moduleUrl);
  const fn = mod[exportName];
  if (typeof fn !== 'function') {
    parentPort.postMessage({
      type: 'result',
      ok: false,
      errorName: 'Error',
      errorMessage: "worker shim: export '" + exportName + "' from " + moduleUrl + " is " + (typeof fn) + ", expected function",
    });
  } else {
    const ctx = {
      sessionId: syntheticCtx.sessionId,
      turnId: syntheticCtx.turnId,
      callId: syntheticCtx.callId,
      cwd: syntheticCtx.cwd,
      signal: abortController.signal,
      log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      fs: broker.fs,
      fetch: broker.fetch,
      exec: broker.exec,
    };
    const out = await fn(input, ctx);
    parentPort.postMessage({ type: 'result', ok: true, value: out });
  }
} catch (e) {
  parentPort.postMessage({
    type: 'result',
    ok: false,
    errorName: e && e.name ? e.name : 'Error',
    errorMessage: e && e.message ? e.message : String(e),
    errorStack: e && e.stack ? e.stack : undefined,
  });
}
`;

interface ResultOk {
  readonly type: 'result';
  readonly ok: true;
  readonly value: unknown;
}
interface ResultFail {
  readonly type: 'result';
  readonly ok: false;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly errorStack?: string;
}
type WorkerMessage = ResultOk | ResultFail | BrokerRequest;

export interface WorkerIsolatorOptions {
  /** Default heap ceiling (MB) when caps.memMb is omitted. Default 256. */
  readonly defaultMemMb?: number;
  /** Default wall-clock budget (ms) when caps.timeMs is omitted. Default 60_000. */
  readonly defaultTimeMs?: number;
}

/**
 * worker_threads-based Isolator with a capability broker.
 *
 * **What this enforces:**
 * - **Memory** — `resourceLimits.maxOldGenerationSizeMb` from `caps.memMb`.
 *   V8 kills the worker if it exceeds the heap budget.
 * - **Wall-clock** — `caps.timeMs` via `setTimeout` → `worker.terminate()`.
 * - **Abort** — parent's `signal` → `worker.terminate()`.
 * - **JS state isolation** — worker has its own module cache, globals,
 *   V8 heap. No closures from the main thread are visible.
 * - **Cap declarations on input** — `checkAllCaps` validates input
 *   fields against `fs` / `net` declarations before launching.
 * - **Mediated fs.readFile** — handlers that use `ctx.fs.readFile()` get
 *   every call re-checked against `caps.fs.read` on the parent side
 *   before the syscall happens.
 * - **Mediated fetch** — handlers that use `ctx.fetch()` get every URL
 *   re-checked against `caps.net` on the parent side before the
 *   socket is opened.
 *
 * **Direct-import escape is closed (loader hook):** the shim registers
 * an ESM loader hook (`LOADER_HOOK_SOURCE`, `BLOCKED_HANDLER_MODULES`)
 * via `module.register()` BEFORE importing the handler module, so a
 * handler that does `import('node:fs')` / `import('node:child_process')`
 * / `import('node:net')` / `import('node:http'/'tls'/...)` (both
 * `node:`-prefixed and bare specifiers) throws at resolution time
 * rather than bypassing the broker. The full broker surface
 * (`fs.readFile` / `fs.writeFile` / `fs.readdir` / `fs.stat` / `fetch`
 * / `exec`) is mediated on the parent side. The loader-hook describe
 * block in `broker-e2e.test.ts` pins this — if you change the blocked
 * set or the brokered ops, keep this doc and that test in sync.
 *
 * **What this still does NOT enforce** (the genuinely-open gaps):
 * - **Env** — the worker inherits the parent's `process.env`. Unlike
 *   the subprocess isolator, there is no env allowlist; secrets in the
 *   parent environment are visible to the handler. Use the subprocess
 *   isolator if you need a curated env.
 * - **No VM / heap isolation beyond V8 limits** — isolation is the
 *   worker's own V8 heap + module cache + globals, plus the
 *   `resourceLimits` heap ceiling. There is no separate VM realm; a
 *   handler that exhausts CPU is only bounded by the wall-clock timer.
 * - **Loader covers ESM resolution only** — it intercepts `import` /
 *   dynamic `import()`. It does NOT close `eval`, `Function`,
 *   `module.createRequire`, `process.binding`, or other reflective
 *   escapes that reach native APIs without going through ESM resolve.
 *
 * The threat model remains "well-behaved handler that opts into the
 * broker," hardened so that the common direct-import bypass is blocked;
 * it is NOT a sandbox against an adversarial handler determined to
 * escape via the reflective gaps above.
 */
export function createWorkerIsolator(opts: WorkerIsolatorOptions = {}): Isolator {
  const defaultMemMb = opts.defaultMemMb ?? 256;
  const defaultTimeMs = opts.defaultTimeMs ?? 60_000;

  return {
    name: 'worker',
    strength: 'worker',
    async run(call, _handler, caps, signal) {
      if (!call.moduleRef) {
        throw new Error(
          `[security:worker] tool '${call.toolName}' has no handlerModule declared; ` +
            `worker isolation requires the tool to be re-importable. Either declare ` +
            `\`isolation.handlerModule\` on the tool, or configure a weaker isolator.`,
        );
      }

      const verdict = checkAllCaps(call.input, caps, call.cwd);
      if (!verdict.ok) {
        throw new Error(`[security:worker] ${verdict.reason}`);
      }

      const timeMs = caps.timeMs ?? defaultTimeMs;
      const memMb = caps.memMb ?? defaultMemMb;

      const workerData = {
        moduleUrl: call.moduleRef.url,
        exportName: call.moduleRef.export,
        input: call.input,
        syntheticCtx: {
          sessionId: call.sessionId,
          turnId: call.turnId,
          callId: call.callId,
          cwd: call.cwd,
        },
        loaderUrl:
          'data:text/javascript,' + encodeURIComponent(LOADER_HOOK_SOURCE),
      };

      const worker = new Worker(SHIM_SOURCE, {
        eval: true,
        workerData,
        resourceLimits: {
          maxOldGenerationSizeMb: memMb,
          maxYoungGenerationSizeMb: Math.max(16, Math.floor(memMb / 4)),
        },
      });

      return new Promise<unknown>((resolve, reject) => {
        const cleanup = new Set<() => void>();
        let settled = false;
        // True once we've hard-terminated (or scheduled the immediate,
        // non-graceful terminate). While settled-but-not-yet-terminated
        // (the graceful abort grace window) we keep servicing brokered
        // requests so a cooperative handler can flush within the caps
        // it already holds — `handleBrokerRequest` still cap-checks
        // every op, so this grants no new authority.
        let terminated = false;
        const hardTerminate = (): void => {
          terminated = true;
          void worker.terminate();
        };
        /**
         * Settle the parent promise and tear the worker down. When
         * `graceful` is set (timeout / host-abort — the handler may
         * still be running), first post `{ type: 'abort' }` so the
         * in-worker `ctx.signal` fires, giving a cooperative handler a
         * short window to bail out and flush, THEN hard-terminate. The
         * parent promise still rejects immediately — the grace window
         * is only about letting in-flight async work clean up before
         * V8 kills the thread, never about delaying the caller.
         */
        const finish = (action: () => void, graceful = false): void => {
          if (settled) return;
          settled = true;
          cleanup.forEach((fn) => fn());
          cleanup.clear();
          action();
          if (graceful) {
            // Best-effort: wake ctx.signal, then terminate after a
            // short grace period. If postMessage throws (worker
            // already gone) just terminate.
            try {
              worker.postMessage({ type: 'abort' });
            } catch {
              // worker already torn down; fall through to terminate.
            }
            const grace = setTimeout(hardTerminate, 150);
            // Don't keep the event loop alive on the grace timer alone.
            grace.unref?.();
          } else {
            hardTerminate();
          }
        };

        if (signal.aborted) {
          finish(
            () =>
              reject(new Error(`[security:worker] tool '${call.toolName}' aborted`)),
            true,
          );
          return;
        }

        const timer = setTimeout(() => {
          finish(
            () =>
              reject(
                new Error(
                  `[security:worker] tool '${call.toolName}' exceeded ${timeMs}ms budget`,
                ),
              ),
            true,
          );
        }, timeMs);
        cleanup.add(() => clearTimeout(timer));

        const onAbort = (): void => {
          finish(
            () =>
              reject(new Error(`[security:worker] tool '${call.toolName}' aborted`)),
            true,
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
        cleanup.add(() => signal.removeEventListener('abort', onAbort));

        worker.on('message', (msg: WorkerMessage) => {
          if (msg.type === 'broker-request') {
            // Service brokered ops until the worker is actually
            // terminated — including during the abort grace window so a
            // cooperative handler can flush. Every op is still
            // cap-checked by `handleBrokerRequest`.
            if (terminated) return;
            void handleBrokerRequest(msg, {
              caps,
              cwd: call.cwd,
              signal,
            }).then((response) => {
              if (!terminated) worker.postMessage(response);
            });
            return;
          }
          if (settled) return;
          // type === 'result' — the terminal message
          if (msg.ok) {
            finish(() => resolve(msg.value));
          } else {
            const e = new Error(msg.errorMessage);
            e.name = msg.errorName;
            if (msg.errorStack) e.stack = msg.errorStack;
            finish(() => reject(e));
          }
        });

        worker.once('error', (e) => {
          finish(() => reject(e instanceof Error ? e : new Error(String(e))));
        });

        worker.once('exit', (code) => {
          if (!settled && code !== 0) {
            finish(() =>
              reject(
                new Error(
                  `[security:worker] worker for '${call.toolName}' exited with code ${code}`,
                ),
              ),
            );
          }
        });
      });
    },
  };
}

/** Default singleton. Use `createWorkerIsolator({...})` to tune limits. */
export const workerIsolator: Isolator = createWorkerIsolator();

/**
 * Auto-discovery entry: a user-installed copy registers the isolator via
 * `PluginSpec.isolators`. Inert until opted into with `security.isolator: 'worker'`.
 */
const plugin: Plugin = definePlugin({
  name: '@moxxy/isolator-worker',
  isolators: [workerIsolator],
});
export default plugin;

// Re-export broker types from plugin-security for convenience.
export {
  handleBrokerRequest,
  type BrokerRequest,
  type BrokerResponse,
  type BrokerOp,
} from '@moxxy/plugin-security';
