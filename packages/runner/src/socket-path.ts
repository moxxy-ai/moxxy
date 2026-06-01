import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

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
  return posixPath;
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
  if (override) return override;
  return platformSocket('serve', path.join(os.homedir(), '.moxxy', 'serve.sock'));
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
