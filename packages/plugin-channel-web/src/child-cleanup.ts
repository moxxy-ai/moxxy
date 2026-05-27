import type { ChildProcess } from 'node:child_process';

/**
 * Guarantees spawned tunnel children (cloudflared/ngrok) never orphan or leak.
 * Node does NOT kill child processes when the parent exits, so we track every
 * live child and kill any survivors on process teardown — in addition to the
 * explicit `close()` path. Each tracked child is also force-killed (SIGKILL)
 * if it ignores SIGTERM, so a wedged tunnel can't drain memory/handles.
 */
const live = new Set<ChildProcess>();
let hooked = false;

function killChild(child: ChildProcess): void {
  if (child.exitCode != null || child.signalCode != null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
  // Escalate if it doesn't exit promptly. unref so this timer never holds the
  // event loop open on its own.
  const t = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* gone */
    }
  }, 2000);
  t.unref?.();
  child.once('exit', () => clearTimeout(t));
}

function ensureHook(): void {
  if (hooked) return;
  hooked = true;
  const killAll = (): void => {
    for (const child of live) {
      try {
        child.kill('SIGKILL'); // process is exiting; be decisive, no async escalation
      } catch {
        /* gone */
      }
    }
    live.clear();
  };
  process.once('exit', killAll);
  process.once('SIGINT', killAll);
  process.once('SIGTERM', killAll);
}

/** Track a spawned child; returns an `untrack()` that also kills it cleanly. */
export function trackChild(child: ChildProcess): () => Promise<void> {
  ensureHook();
  live.add(child);
  child.once('exit', () => live.delete(child));
  return () =>
    new Promise<void>((resolve) => {
      live.delete(child);
      if (child.exitCode != null || child.signalCode != null) return resolve();
      child.once('exit', () => resolve());
      killChild(child);
    });
}
