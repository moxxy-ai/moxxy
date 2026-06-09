import { spawn, type ChildProcess } from 'node:child_process';
import { MoxxyError, defineTool, z } from '@moxxy/sdk';
import { clampString } from './util.js';

/** Max chars of combined output returned to the model (post-exit clamp). */
const OUTPUT_LIMIT = 200_000;
/**
 * Per-stream retention cap while the child is running. Slightly above
 * OUTPUT_LIMIT so the post-exit head clamp always falls inside retained
 * text; everything past it is drained (counted, not stored) so a runaway
 * command (`yes`, `cat /dev/urandom | base64`) can't grow the heap
 * unboundedly before the clamp. Draining (vs killing) preserves the old
 * semantics: the command still runs to completion and reports its real
 * exit code.
 */
const STREAM_RETAIN_CAP = OUTPUT_LIMIT + 4_096;
/** How long after SIGTERM before the whole process group gets SIGKILL. */
const SIGKILL_GRACE_MS = 2_000;

/**
 * Signal the child's whole process group, not just the shell. The shell is
 * spawned `detached` on POSIX so it leads its own group; a negative-pid kill
 * then reaches every descendant (`sh -c 'sleep 1000 & wait'`, build workers,
 * …) instead of orphaning them.
 */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // This tool is effectively POSIX-only (it spawns /bin/sh). Windows has
    // no process groups / negative-pid kill; a real port would shell out to
    // `taskkill /PID <pid> /T /F`. Until then, signal the direct child only.
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    return;
  }
  try {
    // Deliberately *no* "child already exited" guard here: the group outlives
    // its leader (SIGTERM may kill the shell while a TERM-ignoring descendant
    // lives on), and the pgid stays valid — and un-reusable — while any
    // member survives. ESRCH below covers the fully-gone case.
    process.kill(-child.pid, signal);
  } catch (e) {
    // ESRCH: the group is already gone — nothing to do. Anything else
    // (e.g. EPERM, or the child somehow not leading a group): fall back to
    // signalling the shell itself so we at least keep the old behavior.
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
  }
}

/**
 * Bounded output accumulator: retains up to `cap` chars and counts (drains)
 * the rest, so total truncated size can still be reported accurately.
 */
function boundedSink(cap: number): { push: (b: Buffer) => void; readonly text: string; readonly dropped: number } {
  let text = '';
  let dropped = 0;
  return {
    push(b: Buffer): void {
      const s = b.toString('utf8');
      const room = cap - text.length;
      if (room >= s.length) {
        text += s;
      } else {
        if (room > 0) text += s.slice(0, room);
        dropped += s.length - Math.max(room, 0);
      }
    },
    get text() {
      return text;
    },
    get dropped() {
      return dropped;
    },
  };
}

export const bashTool = defineTool({
  name: 'Bash',
  description: 'Run a shell command via /bin/sh. Respects the abort signal. Returns combined stdout/stderr with exit code.',
  inputSchema: z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional().default(120_000),
    env: z.record(z.string(), z.string()).optional(),
  }),
  permission: { action: 'prompt' },
  // Bash is the highest-privilege built-in: it spawns a real shell.
  // Declared caps are *honest* — Bash genuinely needs subprocess + any
  // net + broad fs + a shell-friendly env subset. The `inproc` isolator
  // can only enforce the few fields it can introspect (`cwd` against
  // fs.read, `timeMs` against the wall clock); the command string is
  // opaque to in-process cap checks by design. A future `subprocess`
  // isolator that re-spawns Bash under a constrained env / cgroup would
  // enforce these caps for real.
  isolation: {
    required: 'inproc',
    capabilities: {
      subprocess: true,
      fs: { read: ['$cwd/**', '/tmp/**'], write: ['$cwd/**', '/tmp/**'] },
      net: { mode: 'any' },
      env: ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM'],
      timeMs: 600_000,
    },
  },
  async handler({ command, cwd, timeoutMs, env }, ctx) {
    // An already-aborted signal won't fire an 'abort' event, so the listener
    // below would never run and the child would ignore the abort entirely.
    // Reject up front rather than spawning a process we can't cancel.
    if (ctx.signal.aborted) {
      throw new MoxxyError({ code: 'ABORTED', message: `Bash aborted before start: ${command}` });
    }
    return await new Promise<string>((resolve, reject) => {
      const child = spawn('/bin/sh', ['-lc', command], {
        cwd: cwd ?? ctx.cwd,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group on POSIX so timeout/abort can kill the whole
        // tree via a negative-pid signal. `detached` only detaches the
        // controlling terminal/group — our piped stdio and exit reporting
        // are unaffected. Not meaningful on win32 (would open a console).
        detached: process.platform !== 'win32',
      });

      const out = boundedSink(STREAM_RETAIN_CAP);
      const err = boundedSink(STREAM_RETAIN_CAP);
      child.stdout.on('data', out.push);
      child.stderr.on('data', err.push);

      // SIGTERM the group, then SIGKILL it if it hasn't fully exited within
      // the grace period (covers SIGTERM-ignoring shells/descendants — and
      // descendants holding our stdio pipes open, which would otherwise keep
      // 'close' from ever firing).
      let killTimer: NodeJS.Timeout | undefined;
      const terminate = (): void => {
        killTree(child, 'SIGTERM');
        killTimer ??= setTimeout(() => {
          killTree(child, 'SIGKILL');
        }, SIGKILL_GRACE_MS);
        killTimer.unref();
      };

      const timer = setTimeout(() => {
        terminate();
        reject(
          new MoxxyError({
            code: 'ABORTED',
            message: `Bash timed out after ${timeoutMs}ms: ${command}`,
          }),
        );
      }, timeoutMs);

      const onAbort = (): void => {
        terminate();
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });

      child.on('error', (e: Error) => {
        clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        ctx.signal.removeEventListener('abort', onAbort);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        ctx.signal.removeEventListener('abort', onAbort);
        const combined =
          (out.text ? `[stdout]\n${out.text.trimEnd()}\n` : '') +
          (err.text ? `[stderr]\n${err.text.trimEnd()}\n` : '') +
          `[exit ${code ?? 'null'}]`;
        const dropped = out.dropped + err.dropped;
        if (dropped === 0) {
          resolve(clampString(combined, OUTPUT_LIMIT));
        } else {
          // Same head + marker shape as clampString, with the marker counting
          // the drained chars too — identical to clamping the full output.
          resolve(
            combined.slice(0, OUTPUT_LIMIT) +
              `\n... [truncated ${combined.length + dropped - OUTPUT_LIMIT} chars]`,
          );
        }
      });
    });
  },
});
