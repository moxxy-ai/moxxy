import type { ChildProcess } from 'node:child_process';
import { killTree as killProcessTree } from '@moxxy/sdk/server';

export interface StopAgentOptions {
  readonly platform?: NodeJS.Platform;
  readonly killTree?: (child: ChildProcess, signal: NodeJS.Signals) => void;
}

/**
 * End a live agent process. On Windows an npm install runs the agent under a
 * Node launcher, and ending the launcher alone leaves the native agent
 * running, so the whole tree goes (`taskkill /T`). Elsewhere the process is
 * the agent itself, started without a process group of its own, which a group
 * kill would miss, so it is signalled directly.
 */
export function stopAgentProcess(child: ChildProcess, opts: StopAgentOptions = {}): void {
  if ((opts.platform ?? process.platform) === 'win32') (opts.killTree ?? killProcessTree)(child, 'SIGTERM');
  else child.kill();
}
