import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * OS-level service primitives shared by:
 *   - `moxxy schedule daemon --background` (the scheduler's back-compat shim)
 *   - `moxxy service install <name>` (the generic background-unit installer
 *     for Telegram / HTTP / scheduler channels)
 *
 * Per-platform impls (`launchd.ts` on macOS, `systemd.ts` on Linux) take a
 * `ServiceSpec` describing what to run; `index.ts` exposes the platform-
 * picking entry points (`getServiceStatus`, `installAndStartService`, ...).
 *
 * Unit naming convention is `com.moxxy.<id>` on launchd and
 * `moxxy-<id>.service` on systemd. Logs land in
 * `~/.moxxy/services/<id>.log` (overridable via `MOXXY_HOME`).
 */

export type ServicePlatform = 'darwin' | 'linux' | 'unsupported';

export interface ServiceSpec {
  /** Stable short identifier — used in unit filenames + log path. */
  readonly id: string;
  /** One-line description that lands in the systemd unit's Description=. */
  readonly description: string;
  /** CLI args appended to `[<node>, <cli>]` to build the unit's ExecStart. */
  readonly execArgs: ReadonlyArray<string>;
  /** Extra env vars exported into the daemon process. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ServiceStatus {
  readonly platform: ServicePlatform;
  readonly id: string;
  readonly installed: boolean;
  readonly running: boolean;
  readonly unitPath: string | null;
  readonly logPath: string;
}

export interface ServiceResult {
  readonly ok: boolean;
  readonly message: string;
  readonly logPath: string;
}

export interface SimpleResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface InstallContext {
  readonly node: string;
  readonly cli: string;
  readonly log: string;
  readonly home: string;
}

export interface ServiceProvider {
  readonly platform: Exclude<ServicePlatform, 'unsupported'>;
  getStatus(spec: ServiceSpec): Promise<ServiceStatus>;
  install(spec: ServiceSpec, ctx: InstallContext): Promise<ServiceResult>;
  uninstall(spec: ServiceSpec): Promise<SimpleResult>;
  start(spec: ServiceSpec): Promise<SimpleResult>;
  stop(spec: ServiceSpec): Promise<SimpleResult>;
}

export function servicePlatform(): ServicePlatform {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  return 'unsupported';
}

function moxxyHome(): string {
  return process.env.MOXXY_HOME ?? path.join(homedir(), '.moxxy');
}

export function serviceLogPath(spec: Pick<ServiceSpec, 'id'>): string {
  return path.join(moxxyHome(), 'services', `${spec.id}.log`);
}

export function nodeBin(): string {
  // process.execPath gives the absolute path to the running Node binary,
  // which is what we want — pnpm-installed `moxxy` is also launched via
  // Node, and the user's PATH may not contain a Node at the same path
  // systemd will see.
  return process.execPath;
}

export function cliBin(): string {
  // argv[1] is the resolved path to the JS entry — i.e. /…/packages/cli/dist/bin.js
  // or wherever pnpm linked it. Using it as ExecStart means the daemon
  // tracks whatever binary the user actually installed.
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
