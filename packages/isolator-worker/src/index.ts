import { Worker } from 'node:worker_threads';
import type { Isolator } from '@moxxy/sdk';
import { checkAllCaps } from '@moxxy/plugin-security';

/**
 * Worker entry code, inlined as a string and run via
 * `new Worker(SHIM_SOURCE, { eval: true, workerData })`.
 *
 * Why inline instead of a separate shim file:
 *  - Worker_threads' file form (`new Worker(filename)`) needs the file
 *    to physically exist at a known URL. In a published package the
 *    file lives at `dist/worker-shim.js`, but during `vitest`-on-src
 *    runs `import.meta.url` points into `src/` and there's no real
 *    `.js` there to load. Inline shipping sidesteps that asymmetry.
 *  - The shim is small and stable. The cost of "no TS in this block"
 *    is paid once, here.
 *
 * Unit tests against `runTask` (in `worker-shim.ts`) cover the same
 * logic in a type-checked environment.
 */
const SHIM_SOURCE = `
const { parentPort, workerData } = await import('node:worker_threads');
const { moduleUrl, exportName, input, syntheticCtx } = workerData;
try {
  const mod = await import(moduleUrl);
  const fn = mod[exportName];
  if (typeof fn !== 'function') {
    parentPort.postMessage({
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
      signal: new AbortController().signal,
      log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    };
    const out = await fn(input, ctx);
    parentPort.postMessage({ ok: true, value: out });
  }
} catch (e) {
  parentPort.postMessage({
    ok: false,
    errorName: e && e.name ? e.name : 'Error',
    errorMessage: e && e.message ? e.message : String(e),
    errorStack: e && e.stack ? e.stack : undefined,
  });
}
`;

interface WorkerOk {
  readonly ok: true;
  readonly value: unknown;
}
interface WorkerFail {
  readonly ok: false;
  readonly errorName: string;
  readonly errorMessage: string;
  readonly errorStack?: string;
}
type WorkerMessage = WorkerOk | WorkerFail;

export interface WorkerIsolatorOptions {
  /** Default heap ceiling (MB) when caps.memMb is omitted. Default 256. */
  readonly defaultMemMb?: number;
  /** Default wall-clock budget (ms) when caps.timeMs is omitted. Default 60_000. */
  readonly defaultTimeMs?: number;
}

/**
 * worker_threads-based Isolator.
 *
 * **What this enforces:**
 * - **Memory** — `resourceLimits.maxOldGenerationSizeMb` from `caps.memMb`.
 *   V8 kills the worker if it exceeds the heap budget.
 * - **Wall-clock** — `caps.timeMs` via `setTimeout` → `worker.terminate()`.
 * - **Abort** — parent's `signal` → `worker.terminate()`.
 * - **JS state isolation** — worker has its own module cache, globals,
 *   V8 heap. No closures from the main thread are visible. Handler
 *   must be addressable as a module + export (`isolation.handlerModule`).
 * - **Cap declarations** — `checkAllCaps` validates the input against
 *   `fs` / `net` declarations before launching the worker.
 *
 * **What this does NOT enforce** (Phase 2.1+):
 * - **Filesystem mediation** — the worker can `import('node:fs')` and
 *   read/write whatever the parent process can. `caps.fs` is validated
 *   against input fields but not against actual syscalls.
 * - **Network mediation** — the worker can `fetch()` anywhere. `caps.net`
 *   validates URL-shaped input, not actual sockets.
 * - **Env mediation** — the worker inherits `process.env`.
 *
 * Closing those gaps means re-routing handler fs/net through a parent
 * RPC channel that re-checks each call against the cap spec. Same
 * `Isolator` interface; future iteration.
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
        const finish = (action: () => void): void => {
          cleanup.forEach((fn) => fn());
          cleanup.clear();
          action();
          void worker.terminate();
        };

        const timer = setTimeout(() => {
          finish(() =>
            reject(
              new Error(
                `[security:worker] tool '${call.toolName}' exceeded ${timeMs}ms budget`,
              ),
            ),
          );
        }, timeMs);
        cleanup.add(() => clearTimeout(timer));

        const onAbort = (): void => {
          finish(() =>
            reject(new Error(`[security:worker] tool '${call.toolName}' aborted`)),
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
        cleanup.add(() => signal.removeEventListener('abort', onAbort));

        worker.once('message', (msg: WorkerMessage) => {
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
          if (cleanup.size > 0 && code !== 0) {
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
