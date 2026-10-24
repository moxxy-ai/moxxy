import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { spawnExecutableTarget, type ExecutableTarget } from '@moxxy/sdk/server';
import { OPENCODE_CLI, findAgentCli, stopAgentProcess } from '@moxxy/agent-connection-kit';
import {
  OPENCODE_ACP_ARGS,
  OPENCODE_API_HOST,
  OPENCODE_API_USERNAME,
  OPENCODE_BACKGROUND_SUBAGENTS_ENV,
  OPENCODE_EXECUTABLE_ENV,
  OPENCODE_SERVER_PASSWORD_ENV,
  OPENCODE_SERVER_USERNAME_ENV,
} from './constants.js';
import type { AcpConnection, StartAcpAgent } from './acp-session.js';
import type { OpenCodeApi } from './opencode-api.js';

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

export interface OpenCodeAcpLaunch {
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly api: OpenCodeApi;
}

/**
 * How `opencode acp` is started. It always serves OpenCode's HTTP API beside
 * ACP (on a random port by default); Moxxy picks the port and a password so it
 * can read the subagents OpenCode runs in the background, which ACP does not
 * report, and nothing else on the computer can use the API. Background
 * subagents are switched on unless the person switched them off.
 */
export function opencodeAcpLaunch(opts: {
  readonly port: number;
  readonly password: string;
  /** The environment OpenCode inherits (`process.env`). */
  readonly inherited: Readonly<Record<string, string | undefined>>;
  /** Settings of this start (the restart that asks before changes). */
  readonly env?: Readonly<Record<string, string>>;
}): OpenCodeAcpLaunch {
  const url = `http://${OPENCODE_API_HOST}:${opts.port}`;
  return {
    args: [...OPENCODE_ACP_ARGS, '--port', String(opts.port), '--hostname', OPENCODE_API_HOST],
    env: {
      ...opts.env,
      [OPENCODE_SERVER_USERNAME_ENV]: OPENCODE_API_USERNAME,
      [OPENCODE_SERVER_PASSWORD_ENV]: opts.password,
      [OPENCODE_BACKGROUND_SUBAGENTS_ENV]: opts.inherited[OPENCODE_BACKGROUND_SUBAGENTS_ENV] ?? 'true',
    },
    api: { url, authorization: `Basic ${Buffer.from(`${OPENCODE_API_USERNAME}:${opts.password}`).toString('base64')}` },
  };
}

/** A port free on the loopback right now, for OpenCode to serve its API on. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, OPENCODE_API_HOST, () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port for OpenCode.'))));
    });
  });
}

/** Starts `opencode acp` in the conversation folder, speaking ACP on stdio. */
export function spawnOpenCodeAcp(command: string): StartAcpAgent {
  return async ({ cwd, env }) => {
    const launch = opencodeAcpLaunch({ port: await freePort(), password: randomBytes(24).toString('base64url'), inherited: process.env, ...(env ? { env } : {}) });
    return new Promise<AcpConnection>((resolve, reject) => {
      const child = spawnExecutableTarget(opencodeTarget(command), launch.args, {
        cwd,
        env: launch.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const { stdin, stdout, stderr } = child;
      if (!stdin || !stdout || !stderr) {
        stopAgentProcess(child);
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
          api: launch.api,
          close: () => {
            stdin.end();
            stopAgentProcess(child);
          },
        });
      });
    });
  };
}
