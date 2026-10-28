import type { ChildProcess } from 'node:child_process';
import { killProcessesWithEnv, stopProcessTree } from '@moxxy/sdk/server';

/**
 * Every process a runner starts inherits this variable with the runner's
 * socket, also work an agent detaches on purpose (`(nohup npx vite &)`).
 */
export const RUNNER_SOCKET_ENV = 'MOXXY_RUNNER_SOCKET';

const SIGKILL_GRACE_MS = 2_000;

/**
 * SIGTERM the runner, then SIGKILL if it hasn't exited within the grace
 * window — so a wedged `moxxy serve` can't survive as a zombie holding the
 * socket. What runs below it (agent CLIs, their background commands) goes with
 * it. `detachedWork` also ends what it cut loose: on quitting the app nothing
 * it started keeps serving on localhost, while a restart (new chat, new CLI)
 * leaves the person's dev server running.
 */
export async function stopRunnerProcess(
  child: ChildProcess,
  socketPath: string,
  opts: { readonly detachedWork: boolean },
): Promise<void> {
  await stopProcessTree(child, SIGKILL_GRACE_MS);
  if (opts.detachedWork) await killProcessesWithEnv(RUNNER_SOCKET_ENV, socketPath);
}
