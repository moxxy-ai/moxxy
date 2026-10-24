import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';

/**
 * Signal the child's whole process group, not just the shell. The child must
 * be spawned `detached` on POSIX so it leads its own group; a negative-pid kill
 * then reaches every descendant (`sh -c 'sleep 1000 & wait'`, build workers,
 * …) instead of orphaning them.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // Windows has no process groups; taskkill /T walks the tree down from the
    // shell. Always forced: a console program has no SIGTERM handler to run.
    if (child.exitCode !== null || child.signalCode !== null) return;
    const taskkill = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {
      child.kill(signal);
    });
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

