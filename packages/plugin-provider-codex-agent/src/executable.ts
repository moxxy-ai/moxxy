import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnExecutableTarget, type ExecutableTarget } from '@moxxy/sdk/server';
import { CODEX_CLI, findAgentCli } from '@moxxy/agent-connection-kit';
import { CODEX_APP_SERVER_ARGS } from './constants.js';
import type { CodexConnection, StartCodexAppServer } from './codex-session.js';

export interface CodexTargetOptions {
  readonly platform?: NodeJS.Platform;
  readonly find?: (command: string) => string | null;
  readonly exists?: (file: string) => boolean;
  readonly electron?: boolean;
}

/**
 * How to start the person's Codex without a shell. A Windows npm install puts
 * a `.cmd` shim on PATH, which only a shell can run, so the `codex.js` it
 * points at is run with Node instead; the standalone installer's `codex.exe`
 * runs as it is.
 */
export function codexTarget(command: string, opts: CodexTargetOptions = {}): ExecutableTarget {
  const platform = opts.platform ?? process.platform;
  const found = (opts.find ?? ((name) => findAgentCli(CODEX_CLI, { command: name })))(command);
  if (!found) throw new Error(`Codex CLI not found: ${command}. Install Codex or set CODEX_EXECUTABLE.`);
  const paths = platform === 'win32' ? path.win32 : path;
  const extension = paths.extname(found).toLowerCase();
  if (platform !== 'win32' || extension === '.exe' || extension === '.com') return { kind: 'direct', command: found };
  if (extension !== '.cmd' && extension !== '.bat' && extension !== '.ps1') {
    throw new Error(`Cannot start Codex from ${found}; point CODEX_EXECUTABLE at codex.exe.`);
  }
  const entry = paths.join(paths.dirname(found), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (!(opts.exists ?? existsSync)(entry)) {
    throw new Error(`Cannot find the Codex codex.js behind ${found}; reinstall Codex or point CODEX_EXECUTABLE at codex.exe.`);
  }
  const electron = opts.electron ?? Boolean(process.versions.electron);
  return { kind: 'node', command: process.execPath, entry, env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

/** Starts `codex app-server` in the conversation folder, speaking JSON-RPC on stdio. */
export function spawnCodexAppServer(command: string): StartCodexAppServer {
  return ({ cwd }) =>
    new Promise<CodexConnection>((resolve, reject) => {
      const child = spawnExecutableTarget(codexTarget(command), CODEX_APP_SERVER_ARGS, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const { stdin, stdout, stderr } = child;
      if (!stdin || !stdout || !stderr) {
        child.kill();
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
            child.kill();
          },
        });
      });
    });
}
