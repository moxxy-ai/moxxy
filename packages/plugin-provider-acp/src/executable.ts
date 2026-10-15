import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnExecutableTarget, type ExecutableTarget } from '@moxxy/sdk/server';
import { OPENCODE_CLI, findAgentCli } from '@moxxy/agent-connection-kit';
import { OPENCODE_ACP_ARGS, OPENCODE_EXECUTABLE_ENV } from './constants.js';
import type { AcpConnection, StartAcpAgent } from './acp-session.js';

export interface OpenCodeTargetOptions {
  readonly platform?: NodeJS.Platform;
  readonly find?: (command: string) => string | null;
  readonly exists?: (file: string) => boolean;
}

/**
 * How to start the person's OpenCode without a shell. A Windows npm install
 * puts an `opencode.cmd` shim on PATH, which only a shell can run; the
 * `opencode.exe` it points at is started directly instead. The other
 * installers (scoop, choco, the install script) put `opencode.exe` on PATH.
 */
export function opencodeTarget(command: string, opts: OpenCodeTargetOptions = {}): ExecutableTarget {
  const platform = opts.platform ?? process.platform;
  const found = (opts.find ?? ((name) => findAgentCli(OPENCODE_CLI, { command: name })))(command);
  if (!found) throw new Error(`OpenCode not found: ${command}. Install OpenCode or set ${OPENCODE_EXECUTABLE_ENV}.`);
  const paths = platform === 'win32' ? path.win32 : path;
  const extension = paths.extname(found).toLowerCase();
  if (platform !== 'win32' || extension === '.exe' || extension === '.com') return { kind: 'direct', command: found };
  if (extension !== '.cmd' && extension !== '.bat' && extension !== '.ps1') {
    throw new Error(`Cannot start OpenCode from ${found}; point ${OPENCODE_EXECUTABLE_ENV} at opencode.exe.`);
  }
  const exe = paths.join(paths.dirname(found), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  if (!(opts.exists ?? existsSync)(exe)) {
    throw new Error(`Cannot find the opencode.exe behind ${found}; reinstall OpenCode or point ${OPENCODE_EXECUTABLE_ENV} at opencode.exe.`);
  }
  return { kind: 'direct', command: exe };
}

/** Starts `opencode acp` in the conversation folder, speaking ACP on stdio. */
export function spawnOpenCodeAcp(command: string): StartAcpAgent {
  return ({ cwd, env }) =>
    new Promise<AcpConnection>((resolve, reject) => {
      const child = spawnExecutableTarget(opencodeTarget(command), OPENCODE_ACP_ARGS, {
        cwd,
        ...(env ? { env } : {}),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const { stdin, stdout, stderr } = child;
      if (!stdin || !stdout || !stderr) {
        child.kill();
        reject(new Error('OpenCode started without its stdio.'));
        return;
      }
      child.once('error', reject);
      child.once('spawn', () => {
        child.off('error', reject);
        // A failed write after OpenCode exits is reported by the closed stdout.
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
