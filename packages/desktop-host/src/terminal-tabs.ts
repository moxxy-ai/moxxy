import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createTerminalProcess, type TerminalProcess } from '@moxxy/plugin-terminal';
import type { TerminalTabInfo, TerminalTabSnapshot } from '@moxxy/desktop-ipc-contract';
import { killProcessesWithEnv, moxxyHome } from '@moxxy/sdk/server';

/** Set in a tab's shell: everything started from the tab inherits it, a detached server too. */
export const TERMINAL_TAB_ENV = 'MOXXY_TERMINAL_TAB';

/**
 * Where the main process finds node-pty: beside the installed terminal plugin,
 * where the runner finds it too. The main bundle carries no `node_modules`.
 */
export function installedNodePtyFrom(home: string = moxxyHome()): string {
  return path.join(home, 'plugins', 'node_modules', '@moxxy', 'plugin-terminal', 'package.json');
}

export type TerminalTabEvent =
  | { readonly type: 'data'; readonly tabId: string; readonly data: string }
  | { readonly type: 'exit'; readonly tabId: string; readonly code: number }
  | { readonly type: 'changed'; readonly projectId: string };

export interface TerminalTabsDeps {
  readonly emit: (event: TerminalTabEvent) => void;
  readonly spawn?: (cwd: string, env: Readonly<Record<string, string>>) => Promise<TerminalProcess>;
  /** Stops every process whose environment carries `name=value`. */
  readonly killTagged?: (name: string, value: string) => Promise<unknown>;
  /** Every process on the terminal of a tab's shell, the shell included (its jobs, `nohup` work too). */
  readonly onTerminalOf?: (shellPid: number) => Promise<number[]>;
}

/** How long a closing shell gets to pass SIGHUP on to its jobs before its session is killed. */
const HANGUP_GRACE_MS = 1_000;

/**
 * The processes whose controlling terminal is the shell's (`ps -o tty`): what
 * was typed into the tab, `nohup` work too, which keeps the terminal. Read
 * before the shell goes, while they still have it. None on Windows, where
 * ConPTY ends the console's processes itself.
 */
function processesOnTerminalOf(shellPid: number): Promise<number[]> {
  if (process.platform === 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,tty='], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const rows = stdout
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((cols): cols is [string, string] => cols.length >= 2)
        .map(([pid, tty]) => ({ pid: Number(pid), tty }));
      const tty = rows.find((row) => row.pid === shellPid)?.tty;
      if (!tty || tty === '??' || tty === '?') return resolve([]);
      resolve(rows.filter((row) => row.tty === tty && row.pid !== process.pid).map((row) => row.pid));
    });
  });
}

function sigkill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

interface Tab {
  readonly id: string;
  readonly projectId: string;
  readonly number: number;
  readonly proc: TerminalProcess;
  readonly unsubscribe: () => void;
}

/**
 * The person's own terminal tabs, per project (one folder): shells the app
 * owns, so they outlive a chat's runner and are shared by every chat of the
 * project. The agent's terminal stays the runner's (`plugin-terminal`).
 * Closing a tab stops everything started from it; so does quitting the app.
 */
export class TerminalTabs {
  private readonly tabs = new Map<string, Tab>();
  private readonly spawn: NonNullable<TerminalTabsDeps['spawn']>;
  private readonly killTagged: NonNullable<TerminalTabsDeps['killTagged']>;
  private readonly onTerminalOf: NonNullable<TerminalTabsDeps['onTerminalOf']>;

  constructor(private readonly deps: TerminalTabsDeps) {
    this.spawn = deps.spawn ?? ((cwd, env) => createTerminalProcess(cwd, { env, nodePtyFrom: installedNodePtyFrom() }));
    this.killTagged = deps.killTagged ?? killProcessesWithEnv;
    this.onTerminalOf = deps.onTerminalOf ?? processesOnTerminalOf;
  }

  list(projectId: string): TerminalTabInfo[] {
    return [...this.tabs.values()].filter((tab) => tab.projectId === projectId).map(info);
  }

  async open(projectId: string, cwd: string): Promise<TerminalTabInfo> {
    const id = randomUUID();
    const proc = await this.spawn(cwd, { [TERMINAL_TAB_ENV]: id });
    const offData = proc.onData((data) => this.deps.emit({ type: 'data', tabId: id, data }));
    const offExit = proc.onExit((code) => {
      if (!this.tabs.has(id)) return;
      this.drop(id);
      this.deps.emit({ type: 'exit', tabId: id, code });
    });
    const tab: Tab = {
      id,
      projectId,
      number: this.freeNumber(projectId),
      proc,
      unsubscribe: () => {
        offData();
        offExit();
      },
    };
    this.tabs.set(id, tab);
    this.deps.emit({ type: 'changed', projectId });
    return info(tab);
  }

  /** What a viewer that attaches now has missed; null for a tab that is gone. */
  attach(tabId: string): TerminalTabSnapshot | null {
    const tab = this.tabs.get(tabId);
    return tab ? { data: tab.proc.scrollback(), backend: tab.proc.backend, ptyError: tab.proc.ptyError } : null;
  }

  input(tabId: string, data: string): void {
    this.tabs.get(tabId)?.proc.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.tabs.get(tabId)?.proc.resize(cols, rows);
  }

  async close(tabId: string): Promise<void> {
    const tab = this.drop(tabId);
    if (!tab) return;
    const shellPid = tab.proc.pid;
    const onTerminal = shellPid === undefined ? [] : await this.onTerminalOf(shellPid).catch(() => []);
    const exited = new Promise<void>((resolve) => {
      if (!tab.proc.alive) resolve();
      else tab.proc.onExit(() => resolve());
    });
    // SIGHUP first, so the shell hangs its jobs up the way closing a terminal window does.
    tab.proc.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, HANGUP_GRACE_MS))]);
    // Then what was on the tab's terminal (a job the shell had no time for, `nohup` work),
    // and what left it but carries the tab's tag (a dev server detached with setsid).
    onTerminal.forEach(sigkill);
    await this.killTagged(TERMINAL_TAB_ENV, tabId).catch(() => undefined);
  }

  async closeProject(projectId: string): Promise<void> {
    await Promise.all(this.list(projectId).map((tab) => this.close(tab.id)));
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.tabs.keys()].map((id) => this.close(id)));
  }

  private drop(tabId: string): Tab | undefined {
    const tab = this.tabs.get(tabId);
    if (!tab) return undefined;
    this.tabs.delete(tabId);
    tab.unsubscribe();
    this.deps.emit({ type: 'changed', projectId: tab.projectId });
    return tab;
  }

  /** The lowest number no open tab of the project uses, the way a new browser window is named. */
  private freeNumber(projectId: string): number {
    const used = new Set([...this.tabs.values()].filter((tab) => tab.projectId === projectId).map((tab) => tab.number));
    let n = 1;
    while (used.has(n)) n += 1;
    return n;
  }
}

function info(tab: Tab): TerminalTabInfo {
  return { id: tab.id, title: `Terminal ${tab.number}` };
}
