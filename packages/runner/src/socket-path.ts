import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { moxxyPath } from '@moxxy/sdk/server';

/**
 * Address of the runner's listening socket. The single place that knows about
 * the OS difference: a filesystem socket on unix, a named pipe on Windows
 * (`node:net` maps "listen on a path" to a named pipe there). Everything above
 * the transport is platform-agnostic.
 *
 * `MOXXY_RUNNER_SOCKET` overrides it - useful for tests and for running
 * multiple isolated runners on one machine.
 */
/**
 * THE single source of truth for the OS difference in runner IPC addressing.
 *
 * Map a logical runner NAME to a platform-correct endpoint: a Windows NAMED PIPE
 * (`\\.\pipe\moxxy-<name>`) or, on unix/macOS, the supplied filesystem socket
 * path. A raw filesystem `.sock` path is NOT a valid Windows pipe name — binding
 * it makes `moxxy serve` fail to start (it exits, and the desktop reports "lost
 * the runner" / "not connected"). Both the listening side (`moxxy serve`) and
 * every client (CLI, desktop pool/supervisor) MUST derive their address from
 * here so they always agree, instead of hand-rolling `if (win32)` branches.
 */
export function platformSocket(
  name: string,
  posixPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    // The Windows pipe namespace is flat — sanitize the name to one safe segment.
    return `\\\\.\\pipe\\moxxy-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  }
  return fitSocketPath(posixPath, platform);
}

/**
 * The longest unix socket path that binds whole: `sun_path` holds 104 bytes on
 * macOS/BSD and 108 on Linux, the closing NUL included. Past it libuv cuts the
 * path without a word, so two long paths that begin alike bind one socket.
 */
export function maxSocketPathBytes(platform: NodeJS.Platform = process.platform): number {
  return platform === 'linux' ? 107 : 103;
}

/**
 * A socket path that binds whole: the path itself when it fits, otherwise a
 * name derived from it in a short folder only this user can enter (the
 * per-user runtime or temp folder) — the same name every time, so the runner
 * and its clients agree.
 */
export function fitSocketPath(
  posixPath: string,
  platform: NodeJS.Platform = process.platform,
  shortDirs: ReadonlyArray<string> = defaultShortDirs(),
): string {
  const max = maxSocketPathBytes(platform);
  if (Buffer.byteLength(posixPath) <= max) return posixPath;
  const name = `moxxy-${createHash('sha256').update(posixPath).digest('hex').slice(0, 16)}.sock`;
  for (const dir of shortDirs) {
    const short = path.join(dir, name);
    if (Buffer.byteLength(short) <= max && isPrivateDir(dir)) return short;
  }
  throw new Error(
    `The socket path ${posixPath} is ${Buffer.byteLength(posixPath)} bytes, longer than the ${max} this system can bind, ` +
      'and there is no short private folder to put it in instead. Point MOXXY_HOME at a shorter folder.',
  );
}

function defaultShortDirs(): string[] {
  return [process.env.XDG_RUNTIME_DIR, os.tmpdir()].filter((dir): dir is string => Boolean(dir));
}

/** A folder this user owns and nobody else can enter — a socket in it is reachable by this user alone. */
function isPrivateDir(dir: string): boolean {
  try {
    const st = statSync(dir);
    const mine = typeof process.getuid !== 'function' || st.uid === process.getuid();
    return st.isDirectory() && mine && (st.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/**
 * True for a Windows named-pipe address. Such endpoints have NO parent directory
 * and are NOT filesystem entries (they self-clean when the owning process
 * exits), so callers must skip `mkdir`/`unlink`/`chmod`/`existsSync` on them.
 */
export function isNamedPipe(address: string): boolean {
  return address.startsWith('\\\\.\\pipe\\') || address.startsWith('//./pipe/');
}

export function runnerSocketPath(): string {
  const override = process.env.MOXXY_RUNNER_SOCKET;
  if (override) return process.platform === 'win32' || isNamedPipe(override) ? override : fitSocketPath(override);
  // Resolve under `moxxyPath` (honors `$MOXXY_HOME`, falling back to `~/.moxxy`)
  // so the runner socket follows the same data dir as the rest of the framework
  // instead of stranding it at a hardcoded `~/.moxxy` when MOXXY_HOME is set.
  return platformSocket('serve', moxxyPath('serve.sock'));
}

/**
 * Probe whether a runner is currently listening. Used by channel commands to
 * decide attach-vs-self-host. A connect that succeeds means "up"; any error
 * (ENOENT, ECONNREFUSED) means "no runner".
 */
export function isRunnerUp(socketPath: string = runnerSocketPath()): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(socketPath);
    const finish = (up: boolean): void => {
      socket.destroy();
      resolve(up);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
