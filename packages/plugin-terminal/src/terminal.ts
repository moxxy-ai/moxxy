import { defineSurface, defineTool, z, type SurfaceInstance } from '@moxxy/sdk';
import { createTerminalProcess, type TerminalProcess } from './pty.js';

/**
 * Shared terminal processes, keyed by cwd. The surface and the `terminal` tool
 * resolve the SAME process for a cwd, so a command the agent runs appears in the
 * pane the user is watching (and vice-versa). A dead process is replaced on the
 * next request.
 */
const shared = new Map<string, TerminalProcess>();

async function getSharedTerminal(cwd: string): Promise<TerminalProcess> {
  const existing = shared.get(cwd);
  if (existing && existing.alive) return existing;
  const proc = await createTerminalProcess(cwd);
  shared.set(cwd, proc);
  proc.onExit(() => {
    if (shared.get(cwd) === proc) shared.delete(cwd);
  });
  return proc;
}

/** Dispose every shared terminal (plugin shutdown / session close). */
export function closeAllTerminals(): void {
  for (const proc of shared.values()) proc.kill();
  shared.clear();
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
        for (const cb of dataSubs) cb(payload);
      };
      const unsubData = proc.onData((data) => emit({ type: 'data', data }));
      const unsubExit = proc.onExit((code) => emit({ type: 'exit', code }));
      return {
        id: 'terminal',
        kind: 'terminal',
        onData: (cb) => {
          dataSubs.add(cb);
          return () => dataSubs.delete(cb);
        },
        snapshot: () => ({ type: 'snapshot', data: proc.scrollback(), backend: proc.backend }),
        input: (msg) => {
          if (msg.type === 'data' && typeof msg.data === 'string') proc.write(msg.data);
        },
        resize: (size) => {
          if (size.cols && size.rows) proc.resize(size.cols, size.rows);
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
  let seq = 0;
  return defineTool({
    name: 'terminal',
    description:
      'Run a shell command in the user-visible terminal and return its output. ' +
      'The terminal is SHARED with the user — they see what you run and can take over. ' +
      'Use this to run applications or commands for the user (builds, scripts, CLIs). ' +
      'For long-running/interactive programs, expect partial output up to the timeout.',
    inputSchema: terminalInputSchema,
    handler: async (input, ctx) => {
      const proc = await getSharedTerminal(ctx.cwd ?? process.cwd());
      const timeoutMs = input.timeoutMs ?? 30_000;
      const marker = `__MOXXY_DONE_${Date.now().toString(36)}_${seq++}__`;
      return runCommand(proc, input.command, marker, timeoutMs);
    },
  });
}

/**
 * Write `command` then a sentinel `printf` to a shared shell and collect output
 * until the sentinel line appears. Returns the captured output (best-effort
 * stripped of the echoed sentinel command) + the exit code parsed from it.
 */
function runCommand(
  proc: TerminalProcess,
  command: string,
  marker: string,
  timeoutMs: number,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let acc = '';
    let settled = false;
    const finish = (exitCode: number | null, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      resolve({ output: cleanOutput(acc, command, marker), exitCode, timedOut });
    };
    const unsub = proc.onData((d) => {
      acc += d;
      // The sentinel prints "<marker> <exit>" on its own line once the command
      // finishes. Match the VALUE form (not the echoed command that contains
      // `$?`), so the literal command line doesn't false-trigger completion.
      const m = new RegExp(`${marker} (\\d+)`).exec(acc);
      if (m) finish(Number(m[1]), false);
    });
    const timer = setTimeout(() => finish(null, true), timeoutMs);
    // Two lines to the interactive shell: the command, then the sentinel whose
    // $? reflects the command's exit. On a non-PTY pipe the shell still runs
    // both sequentially.
    proc.write(`${command}\n`);
    proc.write(`printf '%s %s\\n' "${marker}" "$?"\n`);
  });
}

/** Strip the echoed command + sentinel lines so the model sees just the output. */
function cleanOutput(acc: string, command: string, marker: string): string {
  return acc
    .split('\n')
    .filter(
      (line) =>
        !line.includes(marker) &&
        line.trim() !== command.trim() &&
        !line.includes(`printf '%s %s\\n' "${marker}"`),
    )
    .join('\n')
    .trim();
}
