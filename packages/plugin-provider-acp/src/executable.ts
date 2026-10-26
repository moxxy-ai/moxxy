import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawnExecutableTarget, type ExecutableTarget } from '@moxxy/sdk/server';
import {
  OPENCODE_CLI,
  agentCliTargetAt,
  compareVersions,
  findAgentCli,
  readCliVersion,
  stopAgentProcess,
  type AgentCliTargetOptions,
} from '@moxxy/agent-connection-kit';
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

export interface OpenCodeTargetOptions extends AgentCliTargetOptions {
  readonly find?: (command: string) => string | null;
}

/**
 * How to start the person's OpenCode without a shell. A Windows npm install
 * puts an `opencode.cmd` shim on PATH, which only a shell can run; the
 * `opencode.exe` it points at is started directly instead. The other
 * installers (scoop, choco, the install script) put `opencode.exe` on PATH.
 */
export function opencodeTarget(command: string, opts: OpenCodeTargetOptions = {}): ExecutableTarget {
  const found = (opts.find ?? ((name) => findAgentCli(OPENCODE_CLI, { command: name })))(command);
  if (!found) throw new Error(`OpenCode not found: ${command}. Install OpenCode or set ${OPENCODE_EXECUTABLE_ENV}.`);
  return agentCliTargetAt(OPENCODE_CLI, found, opts);
}

export interface OpenCodeAcpLaunch {
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  /** OpenCode's HTTP API, when this OpenCode serves it beside ACP. */
  readonly api?: OpenCodeApi;
}

/**
 * Whether `opencode acp` serves OpenCode's HTTP API beside ACP. OpenCode 1
 * does, on `--port` / `--hostname`; OpenCode 2 runs a private server with no
 * port and refuses those flags. An unreadable version is started as OpenCode
 * 2 is, since `acp` alone starts on both.
 */
export function opencodeServesApiBesideAcp(version: string | null): boolean {
  return version !== null && compareVersions(version, '2.0.0-0') < 0;
}

/**
 * How `opencode acp` is started. Given a `server`, OpenCode serves its HTTP
 * API on that port behind that password, so Moxxy can read the subagents
 * OpenCode runs in the background, which ACP does not report, and nothing
 * else on the computer can use the API. Background subagents are switched on
 * unless the person switched them off.
 */
export function opencodeAcpLaunch(opts: {
  readonly server?: { readonly port: number; readonly password: string };
  /** The environment OpenCode inherits (`process.env`). */
  readonly inherited: Readonly<Record<string, string | undefined>>;
  /** Settings of this start (the restart that asks before changes). */
  readonly env?: Readonly<Record<string, string>>;
}): OpenCodeAcpLaunch {
  const env = {
    ...opts.env,
    [OPENCODE_BACKGROUND_SUBAGENTS_ENV]: opts.inherited[OPENCODE_BACKGROUND_SUBAGENTS_ENV] ?? 'true',
  };
  const { server } = opts;
  if (!server) return { args: [...OPENCODE_ACP_ARGS], env };
  return {
    args: [...OPENCODE_ACP_ARGS, '--port', String(server.port), '--hostname', OPENCODE_API_HOST],
    env: {
      ...env,
      [OPENCODE_SERVER_USERNAME_ENV]: OPENCODE_API_USERNAME,
      [OPENCODE_SERVER_PASSWORD_ENV]: server.password,
    },
    api: {
      url: `http://${OPENCODE_API_HOST}:${server.port}`,
      authorization: `Basic ${Buffer.from(`${OPENCODE_API_USERNAME}:${server.password}`).toString('base64')}`,
    },
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
    const target = opencodeTarget(command);
    const server = opencodeServesApiBesideAcp(await readCliVersion(target))
      ? { port: await freePort(), password: randomBytes(24).toString('base64url') }
      : undefined;
    const launch = opencodeAcpLaunch({ inherited: process.env, ...(server ? { server } : {}), ...(env ? { env } : {}) });
    return new Promise<AcpConnection>((resolve, reject) => {
      const child = spawnExecutableTarget(target, launch.args, {
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
          ...(launch.api ? { api: launch.api } : {}),
          close: () => {
            stdin.end();
            stopAgentProcess(child);
          },
        });
      });
    });
  };
}
