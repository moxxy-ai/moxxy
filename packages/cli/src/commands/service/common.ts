import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * OS-level daemonization for `moxxy schedule daemon`. Each platform
 * implements the same three verbs — install (start), stop (unload +
 * remove), status (query). See the per-platform modules:
 *
 *   - launchd.ts — macOS `LaunchAgent` plist
 *   - systemd.ts — Linux `systemd --user` unit
 *
 * Both keep the daemon alive across logouts/restarts and write
 * stdout/stderr to `~/.moxxy/scheduler-daemon.log`. The unit's
 * `ExecStart` points at the node binary + the path to this CLI's
 * `bin.js` (resolved from `process.argv[1]` at install time), invoked
 * as `schedule daemon` (i.e. the foreground form), so a single
 * implementation runs whether you launch it interactively or via the
 * OS supervisor.
 */

export interface DaemonServiceStatus {
  readonly platform: 'darwin' | 'linux' | 'unsupported';
  readonly installed: boolean;
  readonly running: boolean;
  readonly unitPath: string | null;
  readonly logPath: string | null;
}

export interface InstallResult {
  readonly ok: boolean;
  readonly message: string;
  readonly logPath: string;
}

export interface UninstallResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface ServiceProvider {
  readonly platform: 'darwin' | 'linux';
  getStatus(): Promise<DaemonServiceStatus>;
  install(ctx: InstallContext): Promise<InstallResult>;
  uninstall(): Promise<UninstallResult>;
}

export interface InstallContext {
  readonly node: string;
  readonly cli: string;
  readonly log: string;
  readonly home: string;
}

export function logPath(): string {
  return path.join(process.env.MOXXY_HOME ?? path.join(homedir(), '.moxxy'), 'scheduler-daemon.log');
}

export function nodeBin(): string {
  // process.execPath gives the absolute path to the running Node
  // binary, which is what we want — pnpm-installed `moxxy` is also
  // launched via Node, and the user's PATH may not contain a Node at
  // the same path systemd will see.
  return process.execPath;
}

export function cliBin(): string {
  // argv[1] is the resolved path to the JS entry that's currently
  // running — i.e. /…/packages/cli/dist/bin.js or wherever pnpm
  // linked it. Using it as the ExecStart target means the daemon
  // tracks whatever binary the user installed.
  return process.argv[1] ?? '';
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}
