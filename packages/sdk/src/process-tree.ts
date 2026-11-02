import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
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


/**
 * Every process below `pid` (children, grandchildren, …) as `ps` sees it now.
 * POSIX only. Taken BEFORE the parent ends: once it is gone its children are
 * re-parented to init and nothing links them back to it.
 */
function descendantsOf(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid='], (err, stdout) => {
      if (err) return resolve([]);
      const children = new Map<number, number[]>();
      for (const line of stdout.split('\n')) {
        const [child, parent] = line.trim().split(/\s+/).map(Number);
        if (!child || parent === undefined) continue;
        children.set(parent, [...(children.get(parent) ?? []), child]);
      }
      const found: number[] = [];
      const queue = [pid];
      while (queue.length > 0) {
        for (const child of children.get(queue.shift()!) ?? []) {
          found.push(child);
          queue.push(child);
        }
      }
      resolve(found);
    });
  });
}

/**
 * Stop a long-lived child and everything it started, even work it started in
 * its own process group (an agent CLI's `npm run dev`) or left behind on the
 * way out. SIGTERM first so the child can shut its work down itself; SIGKILL
 * once `graceMs` passes; then SIGKILL whatever of its descendants still runs.
 * On Windows `taskkill /T` already walks the tree, so it is used directly.
 */
export async function stopProcessTree(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  // A child whose start failed has no pid and no process to stop. Signalling it
  // anyway reached kill(0, SIGTERM) on Node 22: the caller's whole process group.
  const pid = child.pid;
  if (pid === undefined) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    killTree(child, 'SIGKILL');
    await Promise.race([exited, new Promise((r) => setTimeout(r, graceMs))]);
    return;
  }
  const before = await descendantsOf(pid);
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), graceMs);
    }),
  ]);
  clearTimeout(timer);
  // Work started during the grace is only reachable while the child still lives.
  const late = timedOut ? await descendantsOf(pid) : [];
  if (timedOut) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
  for (const descendant of new Set([...before, ...late])) {
    try {
      process.kill(descendant, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  if (timedOut) await exited;
}

/** Pids of this user's processes whose environment holds `name=value`: `/proc` on Linux, `ps -E` on macOS. */
async function pidsWithEnv(name: string, value: string): Promise<number[]> {
  const entry = `${name}=${value}`;
  if (process.platform === 'linux') {
    const pids = (await readdir('/proc').catch(() => [] as string[])).filter((dir) => /^\d+$/.test(dir));
    const found: number[] = [];
    for (const pid of pids) {
      const environ = await readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '');
      if (environ.split('\0').includes(entry)) found.push(Number(pid));
    }
    return found;
  }
  return new Promise((resolve) => {
    execFile('ps', ['-axEww', '-o', 'pid=,command='], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const found: number[] = [];
      for (const line of stdout.split('\n')) {
        const at = line.indexOf(` ${entry}`);
        const end = at + entry.length + 1;
        if (at < 0 || (end < line.length && line[end] !== ' ')) continue;
        found.push(Number(line.trim().split(/\s+/, 1)[0]));
      }
      resolve(found);
    });
  });
}

/**
 * SIGKILL every process whose environment holds `name=value`, and return
 * their pids. Catches what a tree walk cannot: work an agent cut loose on
 * purpose (`(nohup npx vite &)`) is re-parented to init at once, but still
 * carries the environment it was started with. POSIX only; never this process.
 */
export async function killProcessesWithEnv(name: string, value: string): Promise<number[]> {
  if (process.platform === 'win32') return [];
  const killed: number[] = [];
  for (const pid of await pidsWithEnv(name, value)) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
      killed.push(pid);
    } catch {
      /* already gone, or not ours */
    }
  }
  return killed;
}
