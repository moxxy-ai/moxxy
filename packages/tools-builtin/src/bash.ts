import { MoxxyError, defineTool, z } from '@moxxy/sdk';
import { clampString, dropDanglingSurrogate } from './util.js';
import { backgroundJobs } from './jobs.js';
import { SIGKILL_GRACE_MS, boundedSink, killTree, spawnShell } from './shell.js';

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

export const bashTool = defineTool({
  name: 'Bash',
  icon: 'terminal',
  description:
    'Run a shell command via /bin/sh. Respects the abort signal. Returns combined stdout/stderr with exit code. ' +
    'Set `background: true` for a command that runs long or never ends (a dev server, a watcher, a slow build): ' +
    'it returns a job id at once and keeps running; then use Wait to block until it finishes or prints what you ' +
    'expect, and StopJob to end it.',
  inputSchema: z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional().default(120_000),
    env: z.record(z.string(), z.string()).optional(),
    background: z
      .boolean()
      .optional()
      .describe('Start the command as a background job and return its id immediately; `timeoutMs` does not apply.'),
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
  async handler({ command, cwd, timeoutMs, env, background }, ctx) {
    // An already-aborted signal won't fire an 'abort' event, so the listener
    // below would never run and the child would ignore the abort entirely.
    // Reject up front rather than spawning a process we can't cancel.
    if (ctx.signal.aborted) {
      throw new MoxxyError({ code: 'ABORTED', message: `Bash aborted before start: ${command}` });
    }
    if (background === true) {
      const job = backgroundJobs.start(String(ctx.sessionId), command, { cwd: cwd ?? ctx.cwd, ...(env ? { env } : {}) });
      return (
        `Started background job ${job.id}: ${command}\n` +
        `It keeps running after this call. Call Wait with jobId "${job.id}" to block until it finishes ` +
        '(or prints a line matching `until`), and StopJob to end it.'
      );
    }
    return await new Promise<string>((resolve, reject) => {
      // Model-supplied `env` is trusted to the same degree as `command` and
      // may legitimately re-supply a credential the scrub removed.
      const child = spawnShell(command, { cwd: cwd ?? ctx.cwd, ...(env ? { env } : {}) });

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
        // Flush any trailing partial multibyte sequence held by the decoder.
        out.end();
        err.end();
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
          // Drop a trailing lone surrogate so the head can't end mid-pair.
          resolve(
            dropDanglingSurrogate(combined.slice(0, OUTPUT_LIMIT)) +
              `\n... [truncated ${combined.length + dropped - OUTPUT_LIMIT} chars]`,
          );
        }
      });
    });
  },
});
