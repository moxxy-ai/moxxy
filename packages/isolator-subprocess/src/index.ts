import { spawn } from 'node:child_process';
import { definePlugin, type Isolator, type Plugin } from '@moxxy/sdk';
import {
  buildBrokerEnv,
  checkAllCaps,
  handleBrokerRequest,
  LOADER_HOOK_SOURCE,
  type BrokerRequest,
} from '@moxxy/plugin-security';

/**
 * Child Node shim inlined as a string. The parent spawns it via
 * `node --input-type=module -e SHIM_SOURCE`, then communicates over
 * stdin/stdout using newline-delimited JSON.
 *
 * Why subprocess vs worker_threads:
 *  - **Separate OS process**: own virtual memory, own file descriptor
 *    table, own signal mask, own credentials. The kernel enforces the
 *    boundary, not V8.
 *  - **Restrictable env**: spawn with a curated `env` so `process.env`
 *    in the child is a strict subset of the parent's.
 *  - **Ulimits**: configurable via the spawn `uid/gid` or wrapping
 *    setrlimit (out of scope for this first cut).
 *  - **Slower startup**: ~80–150ms per call vs ~5–20ms for a worker
 *    thread. Pool/reuse is a future optimization; this iteration
 *    spawns fresh per call so each invocation is fully isolated.
 *
 * Protocol over stdio (one JSON object per line):
 *  - parent → child stdin: { type: 'task', ... } (initial)
 *  - parent → child stdin: { type: 'broker-response', id, ok, ... }
 *  - child → parent stdout: { type: 'broker-request', id, op, args }
 *  - child → parent stdout: { type: 'result', ok, ... } (terminal)
 *
 * Anything else on the child's stdout is ignored as diagnostic noise
 * (the handler module might `console.log` — we don't crash on that).
 * stderr is captured and surfaced if the child exits non-zero.
 */
const SHIM_SOURCE = String.raw`
import { stdin, stdout } from 'node:process';
import { register } from 'node:module';

// Hard cap on the parent->child stdin buffer between newlines. A single
// line larger than this (a malformed/oversized broker payload) is a
// protocol violation: drop the line and reset the buffer so the
// disposable child can't be driven to OOM on framing. Mirrors the
// parent's own output cap; the child has no heap ceiling of its own
// unless caps.memMb is set (--max-old-space-size).
const MAX_LINE_BYTES = 8 * 1024 * 1024;

let buffer = '';
let nextId = 1;
const pending = new Map();
let task = null;
// Cooperative-cancel signal handed to the handler as ctx.signal. The
// parent posts { type: 'abort' } on timeout / host-abort (before the
// SIGTERM -> SIGKILL escalation), giving a well-behaved handler that
// wired ctx.signal into fetch / long loops a chance to bail out and
// flush. Mirrors the worker isolator's cooperative-cancel behaviour.
const abortController = new AbortController();

function send(obj) {
  stdout.write(JSON.stringify(obj) + '\n');
}

function rpc(op, args) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ type: 'broker-request', id, op, args });
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

stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  buffer += chunk;
  // Frame with a moving scan offset and slice the carry-over exactly
  // once per data event, avoiding O(n^2) reslicing on many small lines.
  let start = 0;
  let nl;
  while ((nl = buffer.indexOf('\n', start)) >= 0) {
    const line = buffer.slice(start, nl);
    start = nl + 1;
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'abort') {
      try { abortController.abort(new DOMException('aborted by isolator', 'AbortError')); }
      catch { abortController.abort(); }
    } else if (msg.type === 'task' && !task) {
      task = msg;
      runTask().catch((e) => {
        send({ type: 'result', ok: false, errorName: e && e.name || 'Error', errorMessage: e && e.message || String(e), errorStack: e && e.stack });
      });
    } else if (msg.type === 'broker-response') {
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else {
        const e = new Error(msg.errorMessage);
        e.name = msg.errorName || 'Error';
        p.reject(e);
      }
    }
  }
  buffer = start > 0 ? buffer.slice(start) : buffer;
  // An unterminated line past the cap is a framing/flood violation —
  // drop it rather than buffering unbounded inside the child.
  if (buffer.length > MAX_LINE_BYTES) buffer = '';
});
// Parent may close stdin abruptly (it is dying or escalating to
// SIGKILL); swallow the resulting EPIPE so it doesn't crash the child.
stdin.on('error', () => {});

async function runTask() {
  const { moduleUrl, exportName, input, syntheticCtx, loaderUrl } = task;
  // Block dangerous imports inside the handler module. Static
  // imports above (node:process, node:module) ran before register()
  // and are not affected.
  register(loaderUrl, import.meta.url);
  const mod = await import(moduleUrl);
  const fn = mod[exportName];
  if (typeof fn !== 'function') {
    send({ type: 'result', ok: false, errorName: 'Error', errorMessage: "subprocess shim: export '" + exportName + "' is " + (typeof fn) });
    return;
  }
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
  try {
    const out = await fn(input, ctx);
    send({ type: 'result', ok: true, value: out });
  } catch (e) {
    send({ type: 'result', ok: false, errorName: e && e.name || 'Error', errorMessage: e && e.message || String(e), errorStack: e && e.stack });
  }
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
type ChildMessage = ResultOk | ResultFail | BrokerRequest;

export interface SubprocessIsolatorOptions {
  /** Default wall-clock budget (ms) when caps.timeMs is omitted. Default 60_000. */
  readonly defaultTimeMs?: number;
  /**
   * Default soft heap ceiling (MB) passed to the child as
   * `--max-old-space-size` when `caps.memMb` is omitted. Default 256.
   * The child is a regular Node process, so this is V8-enforced (the
   * child crashes on overrun, not the host).
   */
  readonly defaultMemMb?: number;
  /**
   * Hard cap on the total bytes the parent buffers from the child's
   * stdout + stderr. Crossing it is treated as a (potentially hostile)
   * flood: the child is killed and the call rejected so a child that
   * emits a gigantic line / floods output can't OOM the host (the very
   * trust boundary this isolator protects). Default 8 MiB.
   */
  readonly maxOutputBytes?: number;
  /**
   * Allowlist of env keys the child inherits from the parent process.
   * Default: a minimal POSIX-friendly set (PATH/HOME/USER/SHELL/LANG/LC_ALL/TERM).
   * Override per tool via `caps.env`.
   */
  readonly defaultEnvAllowlist?: ReadonlyArray<string>;
  /**
   * Path to the Node binary to spawn. Default: `process.execPath` so the
   * child runs the same Node version as the parent.
   */
  readonly nodePath?: string;
}

/**
 * Grace period after a cooperative SIGTERM before escalating to an
 * unmaskable SIGKILL. Bounds a runaway/SIGTERM-ignoring handler so the
 * `timeMs` budget actually stops work rather than just rejecting the
 * Promise while the child keeps burning a core.
 */
const KILL_GRACE_MS = 2_000;

/**
 * Default hard cap on parent-buffered child output (stdout + stderr).
 * Mirrors the broker's own `MAX_BROKER_OUTPUT_BYTES` (8 MiB): the broker
 * caps the child's output because it must not trust a potentially
 * hostile child, and the isolator's raw stdio firehose deserves the same
 * bound. Tunable via `SubprocessIsolatorOptions.maxOutputBytes`.
 */
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Cap on retained stderr. Only the tail is surfaced in the exit error,
 * so an unbounded stderr flood would buffer needlessly. Keep the most
 * recent slice (the part likely to carry the failure).
 */
const MAX_STDERR_BYTES = 64 * 1024;

/**
 * Grace window after posting `{ type: 'abort' }` to the child (on
 * timeout / host-abort) before the SIGTERM -> SIGKILL escalation. Lets a
 * cooperative handler observe `ctx.signal` and flush; the parent promise
 * still rejects immediately, so this never delays the caller.
 */
const ABORT_GRACE_MS = 150;

/**
 * Subprocess-based Isolator.
 *
 * **What this enforces (in addition to everything `worker` does):**
 * - **OS-level process boundary** — kernel-enforced, not V8-enforced.
 *   Out-of-memory or crashing handler can't affect the parent's heap.
 * - **Restricted env** — the child sees only env keys in `caps.env`
 *   (or the configured allowlist). Other vars are not inherited.
 * - **Soft memory ceiling** — `caps.memMb` (falling back to
 *   `defaultMemMb`, default 256; clamped to a finite >= 16) is passed to
 *   the child as `--max-old-space-size`, so a runaway handler crashes the
 *   disposable child rather than exhausting host memory. A non-finite
 *   `caps.timeMs`/`caps.memMb` is rejected loudly rather than silently
 *   defeating the budget / heap ceiling.
 * - **Bounded output** — the parent caps total buffered child output
 *   (stdout + stderr, `maxOutputBytes`, default 8 MiB) and the retained
 *   stderr tail, so a child that floods/emits a gigantic line can't OOM
 *   the host (the trust boundary).
 * - **Cooperative cancel** — on timeout / host-abort the parent posts
 *   `{ type: 'abort' }` (firing the handler's `ctx.signal`) before the
 *   SIGTERM -> SIGKILL escalation, giving a well-behaved handler a grace
 *   window to flush. In-flight brokered `fetch`/`exec` run under an
 *   isolator-owned signal that aborts on timeout too (the host `signal`
 *   doesn't), so a brokered op can't outlive the budget.
 *
 * **What it does NOT enforce** (parity with worker for now):
 * - Direct `node:fs` / `node:child_process` imports inside the child
 *   bypass the broker. Same advisory limitation as worker.
 * - No ulimit/cgroup/namespace setup. The child is just a regular
 *   Node process; if you need stronger sandboxing, use `docker`
 *   (Phase 3+, not yet implemented) or wrap the spawned binary in
 *   the OS-level sandbox of your choice.
 */
export function createSubprocessIsolator(opts: SubprocessIsolatorOptions = {}): Isolator {
  const defaultTimeMs = opts.defaultTimeMs ?? 60_000;
  const defaultMemMb = opts.defaultMemMb ?? 256;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const nodePath = opts.nodePath ?? process.execPath;

  return {
    name: 'subprocess',
    strength: 'subprocess',
    async run(call, _handler, caps, signal) {
      if (!call.moduleRef) {
        throw new Error(
          `[security:subprocess] tool '${call.toolName}' has no handlerModule declared; ` +
            `subprocess isolation requires the tool to be re-importable.`,
        );
      }

      const verdict = checkAllCaps(call.input, caps, call.cwd);
      if (!verdict.ok) {
        throw new Error(`[security:subprocess] ${verdict.reason}`);
      }

      // Coerce + clamp the cap declarations (a semi-trusted authoring
      // surface) before they reach setTimeout / the spawn argv, mirroring
      // the worker isolator. A non-finite value would otherwise silently
      // defeat the headline guarantees: NaN/negative timeMs collapses the
      // wall-clock timer (fire-immediately or never), and memMb === 0 /
      // negative drops the `--max-old-space-size` flag entirely (V8 =
      // "unlimited"), leaving the child with no heap ceiling. Reject
      // non-finite values loudly instead.
      const rawTimeMs = Number(caps.timeMs ?? defaultTimeMs);
      const rawMemMb = Number(caps.memMb ?? defaultMemMb);
      if (!Number.isFinite(rawTimeMs) || !Number.isFinite(rawMemMb)) {
        throw new Error(
          `[security:subprocess] tool '${call.toolName}' has a non-finite cap ` +
            `(timeMs=${String(caps.timeMs)}, memMb=${String(caps.memMb)})`,
        );
      }
      const timeMs = Math.max(1, Math.floor(rawTimeMs));
      const memMb = Math.max(16, Math.floor(rawMemMb));
      // Curate the child env via the shared @moxxy/plugin-security helper so the
      // allowlist contract is single-sourced (its BROKER_DEFAULT_ENV is the
      // fallback when neither caps.env nor a configured allowlist is set).
      const env = buildBrokerEnv({ env: caps.env ?? opts.defaultEnvAllowlist }, undefined);

      // Honour the soft memMb capability via V8's heap ceiling so a
      // runaway handler crashes the disposable child instead of
      // exhausting host memory. memMb is already clamped to a finite >= 16
      // above, so the flag is always emitted. Must precede `-e` (Node
      // ignores `--max-old-space-size` after the eval entry).
      const nodeArgs = ['--input-type=module', `--max-old-space-size=${memMb}`, '-e', SHIM_SOURCE];

      const child = spawn(nodePath, nodeArgs, {
        cwd: call.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // EPIPE / write-after-end on a dying child surfaces asynchronously
      // as a stream 'error'; without a listener Node throws it as an
      // uncaught exception that would terminate the parent. Expected on a
      // child that closed stdin / exited mid-write — swallow it (the sync
      // try/catch around write() handles the synchronous path).
      child.stdin.on('error', () => {});

      return new Promise<unknown>((resolve, reject) => {
        let stderr = '';
        let stdoutBuffer = '';
        let settled = false;
        let exited = false;
        // Isolator-owned signal handed to in-flight broker ops. It is
        // aborted on EITHER a host abort OR a budget timeout, so a brokered
        // fetch/exec started during the graceful grace window — when the
        // host `signal` is NOT yet aborted on the timeout path — is still
        // promptly cancelled instead of running un-cancellable past the
        // budget. Mirrors the worker isolator's `brokerAbort`.
        const brokerAbort = new AbortController();
        const onHostAbortLink = (): void => brokerAbort.abort();
        signal.addEventListener('abort', onHostAbortLink, { once: true });
        // True once we've started tearing the child down (kill issued).
        // While settled-but-not-yet-torndown (the graceful abort grace
        // window) we keep servicing brokered requests so a cooperative
        // handler can flush within the caps it already holds —
        // `handleBrokerRequest` still cap-checks every op, so this grants
        // no new authority. Mirrors the worker isolator's `terminated`.
        let torndown = false;
        // Running byte count across the child's stdout + stderr so a
        // hostile/buggy child that floods either channel can't drive the
        // PARENT (the trust boundary) to OOM. Crossing the cap rejects
        // and kills the child.
        let outputBytes = 0;
        let killEscalation: ReturnType<typeof setTimeout> | undefined;
        const cleanup = new Set<() => void>();
        cleanup.add(() => signal.removeEventListener('abort', onHostAbortLink));
        const killChild = (): void => {
          torndown = true;
          // Only signal a child that actually launched and is still
          // running. On a spawn 'error' (e.g. bad nodePath / ENOENT) there
          // is no pid, and a child that already exited during the abort
          // grace window needs no signal — either way SIGTERM/SIGKILL
          // would be a needless no-op against a dead/non-existent process.
          if (exited || child.pid == null) return;
          child.kill('SIGTERM');
          // SIGTERM is cooperative: a handler stuck in a synchronous CPU
          // loop, or one that traps/ignores SIGTERM, would otherwise keep
          // running unbounded after the budget (note `child.killed` only
          // records that a signal was *sent*, not that the process
          // died). Escalate to an unmaskable SIGKILL after a short grace
          // period if it still hasn't exited. The timer is cleared on the
          // 'exit' event so a child that honours SIGTERM is never
          // needlessly SIGKILLed.
          killEscalation = setTimeout(() => {
            if (!exited) child.kill('SIGKILL');
          }, KILL_GRACE_MS);
          killEscalation.unref?.();
        };
        /**
         * Settle the parent promise and tear the child down. When
         * `graceful` is set (timeout / host-abort — the handler may still
         * be running), first post `{ type: 'abort' }` so the in-child
         * `ctx.signal` fires, giving a cooperative handler a short window
         * to bail out and flush, THEN escalate to SIGTERM/SIGKILL. The
         * parent promise still rejects immediately — the grace window only
         * lets in-flight async work clean up before the kill, never delays
         * the caller. Mirrors the worker isolator's cooperative cancel.
         */
        const finish = (action: () => void, graceful = false): void => {
          if (settled) return;
          settled = true;
          cleanup.forEach((fn) => fn());
          cleanup.clear();
          action();
          // Cancel any in-flight brokered op (a long fetch/exec) once the
          // call has settled, on EVERY teardown path. On a timeout the host
          // `signal` is NOT aborted, so without this a brokered op kicked
          // off mid-call would keep running — and its spawned exec child /
          // open socket would leak — past the budget. Idempotent.
          brokerAbort.abort();
          if (!exited) {
            if (graceful && child.pid != null) {
              try {
                child.stdin.write('{"type":"abort"}\n');
              } catch {
                // Child already closed stdin; fall through to the kill.
              }
              const grace = setTimeout(killChild, ABORT_GRACE_MS);
              grace.unref?.();
            } else {
              killChild();
            }
          }
        };

        if (signal.aborted) {
          finish(
            () =>
              reject(new Error(`[security:subprocess] tool '${call.toolName}' aborted`)),
            true,
          );
          return;
        }

        const timer = setTimeout(() => {
          finish(
            () =>
              reject(
                new Error(
                  `[security:subprocess] tool '${call.toolName}' exceeded ${timeMs}ms budget`,
                ),
              ),
            true,
          );
        }, timeMs);
        cleanup.add(() => clearTimeout(timer));

        const onAbort = (): void => {
          finish(
            () =>
              reject(new Error(`[security:subprocess] tool '${call.toolName}' aborted`)),
            true,
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
        cleanup.add(() => signal.removeEventListener('abort', onAbort));

        // Reject + kill if the child's cumulative output crosses the cap.
        const enforceOutputCap = (): boolean => {
          if (outputBytes <= maxOutputBytes) return false;
          finish(() =>
            reject(
              new Error(
                `[security:subprocess] tool '${call.toolName}' output exceeded ${maxOutputBytes} bytes`,
              ),
            ),
          );
          return true;
        };

        // Send the initial task.
        const task = {
          type: 'task',
          moduleUrl: call.moduleRef!.url,
          exportName: call.moduleRef!.export,
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
        try {
          child.stdin.write(JSON.stringify(task) + '\n');
        } catch (e) {
          finish(() => reject(e instanceof Error ? e : new Error(String(e))));
          return;
        }

        const handleMessage = (msg: ChildMessage): void => {
          if (msg.type === 'broker-request') {
            // Service brokered ops until the child is actually torn down —
            // including during the abort grace window so a cooperative
            // handler can flush. Every op is still cap-checked by
            // `handleBrokerRequest`, so this grants no new authority.
            if (torndown) return;
            void handleBrokerRequest(msg, {
              caps,
              cwd: call.cwd,
              // Isolator-owned signal: aborted on host-abort OR timeout, so a
              // brokered fetch/exec is cancelled even on the timeout path
              // where the host `signal` never aborts. fs.* ops ignore the
              // signal, so a cooperative flush still completes.
              signal: brokerAbort.signal,
            }).then((response) => {
              if (!torndown) {
                try {
                  child.stdin.write(JSON.stringify(response) + '\n');
                } catch {
                  // Child closed stdin; ignore — likely about to exit.
                }
              }
            });
            return;
          }
          if (settled) return;
          if (msg.ok) {
            finish(() => resolve(msg.value));
          } else {
            const e = new Error(msg.errorMessage);
            e.name = msg.errorName;
            if (msg.errorStack) e.stack = msg.errorStack;
            finish(() => reject(e));
          }
        };

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          // Keep reading until the child is actually torn down: during the
          // graceful abort window `settled` is true but a cooperative
          // handler may still emit broker-requests we must service.
          if (torndown) return;
          outputBytes += chunk.length;
          if (enforceOutputCap()) return;
          stdoutBuffer += chunk;
          // Frame with a moving scan offset, slicing the carry-over once
          // per event — avoids O(n^2) reslicing when a child emits many
          // small NDJSON lines in one chunk.
          let start = 0;
          let nl: number;
          while ((nl = stdoutBuffer.indexOf('\n', start)) >= 0) {
            const line = stdoutBuffer.slice(start, nl);
            start = nl + 1;
            if (!line) continue;
            try {
              const msg = JSON.parse(line) as ChildMessage;
              handleMessage(msg);
            } catch {
              // Not a protocol line — ignore. The shim doesn't emit
              // arbitrary stdout, but handler-imported modules might.
            }
            if (torndown) return;
          }
          stdoutBuffer = start > 0 ? stdoutBuffer.slice(start) : stdoutBuffer;
          // A single unterminated line larger than the cap is a protocol
          // violation (no framing newline arriving) — treat it as a flood.
          if (stdoutBuffer.length > maxOutputBytes) enforceOutputCap();
        });

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          if (torndown) return;
          outputBytes += chunk.length;
          if (enforceOutputCap()) return;
          // Only the tail is surfaced in the exit error; retain a bounded
          // window so an stderr flood can't grow this string unbounded.
          stderr += chunk;
          if (stderr.length > MAX_STDERR_BYTES) {
            stderr = stderr.slice(stderr.length - MAX_STDERR_BYTES);
          }
        });

        child.once('error', (e) => {
          finish(() => reject(e instanceof Error ? e : new Error(String(e))));
        });

        child.once('exit', (code, exitSignal) => {
          // The child has been reaped (possibly in response to SIGTERM); no
          // need to escalate to SIGKILL.
          exited = true;
          if (killEscalation) clearTimeout(killEscalation);
          if (!settled) {
            // Distinguish a memory/OOM kill or signal-termination (code
            // null) from a clean non-zero exit so operators can diagnose.
            const how =
              code != null
                ? `subprocess exited with code ${code}`
                : `subprocess terminated by ${exitSignal ?? 'unknown signal'}`;
            const msg = stderr.trim() || how;
            finish(() =>
              reject(new Error(`[security:subprocess] '${call.toolName}': ${msg}`)),
            );
          }
        });
      });
    },
  };
}

/** Default singleton. Use `createSubprocessIsolator({...})` to tune. */
export const subprocessIsolator: Isolator = createSubprocessIsolator();

/**
 * Auto-discovery entry: a user-installed copy registers the isolator via
 * `PluginSpec.isolators`. Inert until opted into with `security.isolator: 'subprocess'`.
 */
const plugin: Plugin = definePlugin({
  name: '@moxxy/isolator-subprocess',
  isolators: [subprocessIsolator],
});
export default plugin;
