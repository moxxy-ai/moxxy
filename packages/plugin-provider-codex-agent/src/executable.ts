import { spawnExecutableTarget, type ExecutableTarget } from '@moxxy/sdk/server';
import { CODEX_CLI, agentCliTargetAt, findAgentCli, stopAgentProcess, type AgentCliTargetOptions } from '@moxxy/agent-connection-kit';
import { CODEX_APP_SERVER_ARGS } from './constants.js';
import type { CodexConnection, StartCodexAppServer } from './codex-session.js';

export interface CodexTargetOptions extends AgentCliTargetOptions {
  readonly find?: (command: string) => string | null;
}

/**
 * How to start the person's Codex without a shell. Behind a Windows npm
 * install's `.cmd` shim that is Codex's own `codex.exe` (its `codex.js` only
 * starts it, in a console window of its own); the standalone installer's
 * `codex.exe` runs as it is.
 */
export function codexTarget(command: string, opts: CodexTargetOptions = {}): ExecutableTarget {
  const found = (opts.find ?? ((name) => findAgentCli(CODEX_CLI, { command: name })))(command);
  if (!found) throw new Error(`Codex CLI not found: ${command}. Install Codex or set CODEX_EXECUTABLE.`);
  return agentCliTargetAt(CODEX_CLI, found, opts);
}

/** Starts `codex app-server` in the conversation folder, speaking JSON-RPC on stdio. */
export function spawnCodexAppServer(command: string): StartCodexAppServer {
  return ({ cwd }) =>
    new Promise<CodexConnection>((resolve, reject) => {
      const child = spawnExecutableTarget(codexTarget(command), CODEX_APP_SERVER_ARGS, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const { stdin, stdout, stderr } = child;
      if (!stdin || !stdout || !stderr) {
        stopAgentProcess(child);
        reject(new Error('Codex started without its stdio.'));
        return;
      }
      child.once('error', reject);
      child.once('spawn', () => {
        child.off('error', reject);
        // A failed write after Codex exits is reported by the closed stdout.
        stdin.on('error', () => undefined);
        resolve({
          readable: stdout,
          writable: stdin,
          stderr,
          close: () => {
            stdin.end();
            stopAgentProcess(child);
          },
        });
      });
    });
}
