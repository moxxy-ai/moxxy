import { randomBytes } from 'node:crypto';
import { defineSurface, defineTool, z, type SurfaceInstance } from '@moxxy/sdk';
import { createTerminalProcess, type TerminalProcess } from './pty.js';

/**
 * Shared terminal processes, keyed by cwd. The surface and the `terminal` tool
 * resolve the SAME process for a cwd, so a command the agent runs appears in the
 * pane the user is watching (and vice-versa). A dead process is replaced on the
 * next request.
 */
const shared = new Map<string, TerminalProcess>();
/**
 * In-flight creates, keyed by cwd. Memoizing the PROMISE (not the resolved
 * process) closes a create race: `createTerminalProcess` awaits, so two
 * concurrent callers for the same cwd would both miss `shared`, both spawn a
 * shell, and the second `set` would orphan the first PTY. By recording the
 * promise synchronously before awaiting, the second caller reuses the first's
 * in-flight create instead of spawning a duplicate.
 */
const pending = new Map<string, Promise<TerminalProcess>>();
/**
 * Monotonic shutdown generation, bumped by every `closeAllTerminals`. A create
 * captures the epoch when it STARTS; if a shutdown happened since (the epoch
 * advanced), its continuation self-disposes — the kill loop already ran and
 * cleared `shared`, so storing that freshly-spawned shell would strand a live
 * PTY/child past session teardown (the onShutdown hook already fired).
 *
 * A counter, not a boolean, on purpose: a new session reusing this module
 * singleton calls `getSharedTerminal` again, which must re-arm so the NEW
 * create is retained. A boolean reset on every call would ALSO resurrect a
 * STALE pre-shutdown create that resolves after the re-arm, double-spawning and
 * orphaning a shell. Comparing the create's captured epoch to the live one
 * disposes only the creates that actually straddle a shutdown, regardless of
 * later re-arms.
 */
let epoch = 0;

export async function getSharedTerminal(
  cwd: string,
  create: (cwd: string) => Promise<TerminalProcess> = createTerminalProcess,
): Promise<TerminalProcess> {
  const existing = shared.get(cwd);
  if (existing && existing.alive) return existing;
  const inFlight = pending.get(cwd);
  if (inFlight) return inFlight;
  // Capture the epoch this create belongs to. If a shutdown bumps `epoch` while
  // we await, the continuation sees the mismatch and disposes the orphan.
  const startedEpoch = epoch;
  const promise = (async () => {
    const proc = await create(cwd);
    // A shutdown landed while this create was in flight (epoch advanced) — the
    // kill loop already ran and cleared `shared`, so dispose this orphan
    // immediately instead of storing a shell nothing will ever kill.
    if (epoch !== startedEpoch) {
      proc.kill();
      return proc;
    }
    shared.set(cwd, proc);
    proc.onExit(() => {
      if (shared.get(cwd) === proc) shared.delete(cwd);
    });
    return proc;
  })().finally(() => {
    // Clear the in-flight slot only once this create settles, AND only if it's
    // still ours — a shutdown + re-arm may have replaced the slot with a newer
    // create for the same cwd, which we must not clobber.
    if (pending.get(cwd) === promise) pending.delete(cwd);
  });
  pending.set(cwd, promise);
  return promise;
}

/** Dispose every shared terminal (plugin shutdown / session close). */
export function closeAllTerminals(): void {
  // Bump the epoch FIRST so any create that resolves after this point sees the
  // mismatch and self-kills (see getSharedTerminal). `pending.clear()` alone is
  // insufficient — the promise body still runs to completion and would
  // otherwise store the proc.
  epoch += 1;
  for (const proc of shared.values()) proc.kill();
  shared.clear();
  pending.clear();
}

/** A terminal dimension (cols/rows) is usable only if it's a finite, positive
 *  number. Rejects NaN/Infinity/0/negatives/floats-with-no-magnitude before
 *  they reach the PTY, where they'd throw or be silently coerced. */
function isValidDimension(n: number | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1;
}

// --- Surface ----------------------------------------------------------------

/** The `terminal` surface: streams the shared PTY's output and feeds a viewer's
 *  keystrokes / resizes back into it. */
export function buildTerminalSurface() {
  return defineSurface({
    kind: 'terminal',
    description: 'An embedded shell the user and the agent share.',
    open: async (ctx): Promise<SurfaceInstance> => {
      const proc = await getSharedTerminal(ctx.cwd);
      const dataSubs = new Set<(payload: unknown) => void>();
      const emit = (payload: unknown): void => {
        for (const cb of dataSubs) {
          try {
            cb(payload);
          } catch {
            /* a bad viewer must not break the stream (matches pty.ts emitData) */
          }
        }
      };
      const unsubData = proc.onData((data) => emit({ type: 'data', data }));
      const unsubExit = proc.onExit((code) => emit({ type: 'exit', code }));
      // Honest degraded state: without a real PTY the pane can't function as an
      // interactive terminal (no echo, a viewer's Enter never reaches the shell).
      // Tell the viewer rather than presenting a box that silently ignores input.
      if (proc.backend === 'pipe') {
        emit({
          type: 'status',
          text: proc.ptyError
            ? `Terminal unavailable: the PTY backend failed to start (${proc.ptyError}).`
            : 'Terminal unavailable: a real PTY backend (node-pty) is not available.',
        });
      }
      return {
        id: 'terminal',
        kind: 'terminal',
        onData: (cb) => {
          dataSubs.add(cb);
          return () => dataSubs.delete(cb);
        },
        snapshot: () => ({
          type: 'snapshot',
          data: proc.scrollback(),
          backend: proc.backend,
          ptyError: proc.ptyError,
        }),
        input: (msg) => {
          if (msg.type === 'data' && typeof msg.data === 'string') {
            proc.write(msg.data);
          } else {
            // A viewer/relay sending a wrong-shaped message (field rename,
            // numeric data, protocol skew) gets the keystroke silently dropped.
            // Log it so the "terminal ignores my input" symptom is diagnosable.
            ctx.logger?.debug?.('terminal surface dropped unrecognized input', { type: msg.type });
          }
        },
        resize: (size) => {
          // Validate before touching the PTY: a viewer/relay may send NaN,
          // Infinity, floats, negatives, or 0 (SurfaceSize.cols/rows are bare
          // `number`s — anything decoded off the wire). `resize` in pty.ts also
          // clamps, but reject obviously-bad shapes here with a diagnostic so a
          // dropped resize is traceable rather than a silent no-op.
          if (isValidDimension(size.cols) && isValidDimension(size.rows)) {
            proc.resize(size.cols as number, size.rows as number);
          } else {
            ctx.logger?.debug?.('terminal surface dropped malformed resize', { size });
          }
        },
        close: () => {
          // Detach this viewer; the underlying shared process stays alive for
          // the agent's tool and any other viewer (closed on session teardown).
          unsubData();
          unsubExit();
        },
      };
    },
  });
}

// --- Tool -------------------------------------------------------------------

const terminalInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(10_000)
    .describe('A shell command to run in the user-visible terminal.'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(600_000)
    .optional()
    .describe('Max time to wait for the command to finish (default 30s).'),
});

/**
 * The `terminal` tool runs a command in the SHARED terminal the user sees. It
 * appends a unique sentinel that echoes the exit code, then reads output until
 * the sentinel returns — reliable completion detection in an interactive,
 * input-echoing shell. The command and its output stay visible to the user, who
 * can take over at any time.
 */
export function buildTerminalTool() {
  return defineTool({
    name: 'terminal',
    description:
      'Run a shell command in the user-visible terminal and return its output. ' +
      'The terminal is SHARED with the user — they see what you run and can take over. ' +
      'Use this to run applications or commands for the user (builds, scripts, CLIs). ' +
      'For long-running/interactive programs, expect partial output up to the timeout.',
    inputSchema: terminalInputSchema,
    // Bash-class honest caps: this drives a real shell (node-pty), so the
    // command can touch anything the user could. The shared shell deliberately
    // inherits the FULL runner env (see the SECURITY note in pty.ts); the env
    // list below is the shell-relevant subset an enforcing isolator should
    // provide when it re-spawns under a constrained env.
    isolation: {
      capabilities: {
        subprocess: true,
        fs: { read: ['$cwd/**', '/tmp/**'], write: ['$cwd/**', '/tmp/**'] },
        net: { mode: 'any' },
        env: ['PATH', 'HOME', 'USER', 'SHELL', 'COMSPEC', 'LANG', 'LC_ALL', 'TERM'],
        timeMs: 600_000,
      },
    },
    handler: async (input, ctx) => {
      const proc = await getSharedTerminal(ctx.cwd ?? process.cwd());
      const timeoutMs = input.timeoutMs ?? 30_000;
      // Honor the turn's abort signal: when the loop/user cancels the turn, the
      // command must stop waiting PROMPTLY rather than blocking the tool slot for
      // up to the full timeout (600s) on a session that's already being torn down.
      // We do NOT kill the shared shell (it's user-facing and may host other work)
      // — we just stop awaiting its sentinel.
      return runCommand(proc, input.command, makeMarker(), timeoutMs, ctx.signal);
    },
  });
}

/**
 * A high-entropy, unpredictable completion marker. The exit code is detected by
 * matching `<marker> <digits>` on its own line; a time+counter marker was
 * predictable, so untrusted command output (a printed file, a remote response)
 * could deliberately emit `<predicted-marker> <chosen-exit>` to spoof an
 * attacker-chosen exit status and truncate the output. 64 bits of randomness
 * makes that practically impossible to reproduce.
 */
function makeMarker(): string {
  return `__MOXXY_DONE_${randomBytes(8).toString('hex')}__`;
}

/**
 * Cap the per-command accumulator. The shared scrollback in pty.ts is bounded,
 * but THIS accumulator is per-call: a command that floods output before its
 * sentinel arrives (`cat huge.log`, `yes`, a `tail -f` that never returns until
 * the 600s timeout) would otherwise grow `acc` unbounded → OOM the runner. The
 * sentinel is always at the END of the stream, so retaining only the tail keeps
 * detection correct while making memory O(cap) instead of O(total output).
 */
const MAX_ACC = 1_000_000;

/**
 * Per-shared-process command serialization. The surface and the tool share ONE
 * shell per cwd; runCommand writes `command` + a sentinel `printf` and reads the
 * merged stream until ITS sentinel appears. With no serialization, two
 * concurrent tool calls (parallel tool calls are normal) — or a tool call
 * overlapping a user typing in the pane — would interleave their command +
 * sentinel writes into one line-oriented shell, scrambling output and letting
 * each `$?` capture the OTHER command's exit. We hold a per-proc tail promise: a
 * command writes only once the previous one on the same shell has finished, so
 * writes are single-file. The entry is deleted once the shell goes idle, so the
 * NEXT command on an idle shell writes synchronously (no microtask hop) —
 * preserving the single-command happy path exactly (listener + write in the same
 * tick the caller invokes runCommand). Keyed weakly so a disposed process drops
 * its tail.
 */
const commandTails = new WeakMap<TerminalProcess, Promise<void>>();

/**
 * Write `command` then a sentinel `printf` to a shared shell and collect output
 * until the sentinel line appears. Returns the captured output (best-effort
 * stripped of the echoed sentinel command) + the exit code parsed from it.
 *
 * Serialized per shared process: a command writes only once the previous one on
 * the same shell finishes, so concurrent callers never interleave their writes
 * on the single stdin and each `$?` reflects its OWN command.
 */
export function runCommand(
  proc: TerminalProcess,
  command: string,
  marker: string,
  timeoutMs: number,
  /** Optional turn-abort signal; firing it finishes the command immediately
   *  (timedOut=false) without waiting for the sentinel or the timeout. */
  signal?: AbortSignal,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  // Idle shell (no pending tail) → write synchronously (undefined). Busy shell →
  // defer this command's writes until the current tail settles.
  const startWrites = commandTails.get(proc);
  const run = runCommandSerialized(proc, command, marker, timeoutMs, startWrites, signal);
  // This command becomes the new tail; later callers wait on it. Swallow
  // rejections (it never rejects today) so one failure can't poison the queue.
  const settled = run.then(
    () => {},
    () => {},
  );
  commandTails.set(proc, settled);
  // Once this command settles, if nothing newer queued behind it, the shell is
  // idle again — drop the entry so the next command writes synchronously.
  void settled.then(() => {
    if (commandTails.get(proc) === settled) commandTails.delete(proc);
  });
  return run;
}

function runCommandSerialized(
  proc: TerminalProcess,
  command: string,
  marker: string,
  timeoutMs: number,
  /** Resolves when it's this command's turn to write; undefined = write now. */
  startWrites: Promise<void> | undefined,
  /** Turn-abort signal; firing it finishes immediately (see runCommand). */
  signal: AbortSignal | undefined,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let acc = '';
    let settled = false;
    const finish = (exitCode: number | null, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      unsubData();
      unsubExit();
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      resolve({ output: cleanOutput(acc, command, marker), exitCode, timedOut });
    };
    // Already aborted before we even start? Finish immediately — don't write to
    // the shell, don't arm a timeout. The command never runs; null exit.
    if (signal?.aborted) {
      // `finish` below isn't fully wired yet (unsubData/unsubExit/timer are
      // declared after this point), so resolve directly for the pre-armed case.
      resolve({ output: '', exitCode: null, timedOut: false });
      return;
    }
    // Abort while waiting/running → stop awaiting the sentinel and resolve with a
    // null exit (the command may have partially run; we report what we captured).
    // We deliberately do NOT kill the shared shell here — it is user-facing and
    // may be hosting other work; we only detach this command's reader.
    const onAbort = (): void => finish(null, false);
    signal?.addEventListener('abort', onAbort, { once: true });
    // Compile the sentinel matcher ONCE — `marker` is fixed for this call. The
    // sentinel is `<marker> <digits>`; the marker is `__MOXXY_DONE_<hex>__`, so
    // nothing in it is a regex metacharacter and it needs no escaping. Anchor the
    // match to a REAL newline — `\n` only, NOT the regex `^` — so command OUTPUT
    // that merely CONTAINS the literal string (echoing a captured transcript,
    // grepping a file) cannot false-trigger completion. (`^` is deliberately
    // excluded: we scan a SLICE of the buffer for O(n) cost, and `^` would match
    // the slice's first char even when that char is mid-line — a hostile line
    // like `prefix<marker> 137` whose `<marker>` happens to land at the slice
    // start would otherwise spoof an attacker-chosen exit code. By requiring a
    // literal `\n`, a sentinel is only ever recognized when a genuine newline
    // precedes it in the buffer.) printf always appends a trailing `\n`.
    const sentinel = new RegExp(`\\n${marker} (\\d+)\\r?\\n`);
    // Re-scanning the whole accumulated buffer per chunk is O(n^2). The sentinel
    // appears exactly once (unique marker) and we finish on first match, so it
    // suffices to scan only the new chunk plus a carry-over of the previous
    // tail long enough to catch a sentinel split across the chunk boundary:
    // a leading newline + marker + space + a generous run of digits + trailing
    // newline.
    const carry = marker.length + 64;
    // The shell ALWAYS echoes the command (and our printf) on their own lines, so
    // a real sentinel is always preceded by a newline IN the buffer — we never
    // need to treat the very first byte of the stream as a line start. To keep
    // the `\n`-anchored match correct across the slice boundary, the scan window
    // is widened by one extra leading char so the newline that precedes a
    // sentinel can never be sliced away (see `scanStart` below).
    let scanFrom = 0;
    const unsubData = proc.onData((d) => {
      // Begin the scan window just before the bytes that could only now have
      // completed a sentinel that started in an earlier chunk.
      let from = Math.max(scanFrom, acc.length - carry, 0);
      acc += d;
      // Bound the accumulator: keep only the tail. The sentinel lives at the
      // end of the stream, so trimming the head never drops it. Shift the scan
      // index down by the trimmed amount so the carry-window math stays correct.
      if (acc.length > MAX_ACC) {
        const removed = acc.length - MAX_ACC;
        acc = acc.slice(removed);
        from = Math.max(0, from - removed);
      }
      // Scan from one char BEFORE `from` so the newline that precedes a sentinel
      // straddling the carry boundary is inside the window (the match needs the
      // leading `\n`). Slicing exactly at `from` could otherwise drop that
      // newline and miss — or, with a bare `^` anchor, falsely match — the
      // sentinel. Backing up one char keeps the real preceding newline in scope.
      const scanStart = Math.max(0, from - 1);
      // At the TRUE stream start (scanStart === 0) a sentinel may legitimately be
      // the very first line, with no real newline before it. Prepend a synthetic
      // `\n` ONLY there so the `\n`-anchored match recognizes it — this never
      // creates a false mid-stream line start, because it's applied solely when
      // the slice begins at byte 0 of the whole stream.
      const hay = scanStart > 0 ? acc.slice(scanStart) : `\n${acc}`;
      sentinel.lastIndex = 0;
      const m = sentinel.exec(hay);
      if (m) finish(Number(m[1]), false);
      // Everything before this point can never start a future sentinel match.
      scanFrom = Math.max(0, acc.length - carry);
    });
    // If the shared shell dies while this command runs (user types `exit`, the
    // shell crashes, the process is killed), the sentinel never arrives — finish
    // immediately with the shell's exit code rather than hanging to the full
    // timeout (up to 600s) on a known-dead process.
    const unsubExit = proc.onExit((code) => finish(code, false));
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Two writes to the interactive shell: the command, then the sentinel whose
    // $? reflects the command's exit. A leading newline before the printf
    // terminates any dangling/unterminated command line (trailing backslash,
    // unbalanced quote) so the sentinel is always emitted rather than consumed
    // as a continuation — otherwise such a command would always time out. On a
    // non-PTY pipe the shell still runs both sequentially.
    const writeAndArm = (): void => {
      if (settled) return; // shell died (or we were torn down) before our turn
      // The shell is ALREADY dead at write time (it exited before our turn, or
      // in the TOCTOU window between getSharedTerminal returning it and now).
      // `onExit` won't fire again — it already fired and is single-shot — so a
      // bare write would hang to the full timeout (up to 600s) on a known-dead
      // process. Finish immediately instead. Reported as timedOut=false / null
      // exit: the command never actually ran, so there is no real exit status.
      if (!proc.alive) {
        finish(null, false);
        return;
      }
      timer = setTimeout(() => finish(null, true), timeoutMs);
      proc.write(`${command}\n`);
      proc.write(`\nprintf '%s %s\\n' "${marker}" "$?"\n`);
    };
    // Idle shell → write now (keeps the single-command path fully synchronous).
    // Busy shell → wait our turn; the timeout clock only starts when we write, so
    // a command queued behind a slow predecessor doesn't burn its budget waiting.
    if (startWrites) void startWrites.then(writeAndArm);
    else writeAndArm();
  });
}

/** Strip the echoed command + sentinel lines so the model sees just the output. */
function cleanOutput(acc: string, command: string, marker: string): string {
  // A multi-line command is echoed by an echo-on PTY one line at a time; none of
  // those echoed lines equals the full `command`, so match each command line
  // independently. (Single-line commands are the trivial one-element case.)
  const commandLines = new Set(
    command
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0), // never strip blank output lines
  );
  return acc
    .split('\n')
    .filter(
      (line) =>
        !line.includes(marker) &&
        !commandLines.has(line.trim()) &&
        !line.includes(`printf '%s %s\\n' "${marker}"`),
    )
    .join('\n')
    .trim();
}
