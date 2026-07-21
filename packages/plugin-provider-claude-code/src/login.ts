import { spawn, type SpawnOptions } from 'node:child_process';
import { MoxxyError } from '@moxxy/sdk';
import type {
  ProviderAuthContext,
  ProviderOAuthResult,
  ProviderOAuthStatus,
} from '@moxxy/sdk';
import {
  CLAUDE_AUTH_LOGIN_ARGS,
  CLAUDE_AUTH_LOGOUT_ARGS,
  CLAUDE_AUTH_STATUS_ARGS,
  CLAUDE_CODE_EXECUTABLE_ENV,
  CLAUDE_CODE_PROVIDER_ID,
} from './constants.js';

export type ClaudeCliAuthState = 'signed-in' | 'signed-out' | 'missing' | 'unsupported' | 'error';

export interface ClaudeCliAuthStatus {
  readonly state: ClaudeCliAuthState;
  readonly executable: string;
  readonly accountId?: string;
  readonly message: string;
}

export interface ClaudeCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: NodeJS.ErrnoException;
}

type CommandRunner = (
  executable: string,
  args: readonly string[],
  options?: { readonly inherit?: boolean },
) => Promise<ClaudeCommandResult>;

let runCommandImpl: CommandRunner = runCommand;
/** Test seam. */
export function __setClaudeCommandRunner(runner: CommandRunner): void {
  runCommandImpl = runner;
}

/** Resolve the executable without involving a shell (paths containing spaces are safe). */
export function resolveClaudeExecutable(config: Record<string, unknown> = {}): string {
  const configured = config.executable;
  if (typeof configured === 'string' && configured.trim()) return configured;
  return process.env[CLAUDE_CODE_EXECUTABLE_ENV]?.trim() || 'claude';
}

/** Probe the installed CLI's supported, machine-readable authentication command. */
export async function checkClaudeCliAuth(executable = resolveClaudeExecutable()): Promise<ClaudeCliAuthStatus> {
  const result = await runCommandImpl(executable, CLAUDE_AUTH_STATUS_ARGS);
  if (result.error?.code === 'ENOENT') {
    return {
      state: 'missing', executable,
      message: `Claude CLI executable not found: ${executable}. Install Claude Code or set ${CLAUDE_CODE_EXECUTABLE_ENV}.`,
    };
  }
  if (result.error) {
    return { state: 'error', executable, message: `Could not run Claude CLI: ${result.error.message}` };
  }

  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const parsed = parseStatusOutput(result.stdout);
  if (parsed) {
    if (parsed.loggedIn) {
      return {
        state: 'signed-in', executable,
        ...(parsed.accountId ? { accountId: parsed.accountId } : {}),
        message: `Claude CLI is signed in${parsed.accountId ? ` as ${parsed.accountId}` : ''}.`,
      };
    }
    return { state: 'signed-out', executable, message: 'Claude CLI is installed but signed out. Run `moxxy login claude-code`.' };
  }

  if (looksUnsupported(combined)) {
    return {
      state: 'unsupported', executable,
      message: 'This Claude CLI version does not support `claude auth status`. Update Claude Code and try again.',
    };
  }
  if (result.code !== 0) {
    return {
      state: 'error', executable,
      message: `Claude CLI auth status failed${combined ? `: ${combined}` : ` with exit code ${result.code}`}.`,
    };
  }
  return {
    state: 'unsupported', executable,
    message: 'Claude CLI returned an unrecognized auth-status response. Update Claude Code and try again.',
  };
}

export async function claudeLogin(_ctx: ProviderAuthContext): Promise<ProviderOAuthResult> {
  const executable = resolveClaudeExecutable();
  let status = await checkClaudeCliAuth(executable);
  if (status.state === 'signed-in') return status.accountId ? { accountId: status.accountId } : {};
  if (status.state !== 'signed-out') throw authError(status);

  const login = await runCommandImpl(executable, CLAUDE_AUTH_LOGIN_ARGS, { inherit: true });
  if (login.error) throw authError({ state: login.error.code === 'ENOENT' ? 'missing' : 'error', executable, message: login.error.message });
  if (login.code !== 0) {
    throw new MoxxyError({
      code: 'AUTH_DENIED',
      message: `Claude CLI login failed${login.stderr ? `: ${login.stderr.trim()}` : ` with exit code ${login.code}`}.`,
      hint: 'Run `claude auth login` directly for more detail, then retry.',
      context: { provider: CLAUDE_CODE_PROVIDER_ID },
    });
  }
  status = await checkClaudeCliAuth(executable);
  if (status.state !== 'signed-in') throw authError(status);
  return status.accountId ? { accountId: status.accountId } : {};
}

/** Log out the CLI account. Legacy moxxy vault values are deliberately untouched. */
export async function claudeLogout(_ctx: ProviderAuthContext): Promise<boolean> {
  const executable = resolveClaudeExecutable();
  const before = await checkClaudeCliAuth(executable);
  if (before.state !== 'signed-in') return false;
  const result = await runCommandImpl(executable, CLAUDE_AUTH_LOGOUT_ARGS, { inherit: true });
  if (result.error || result.code !== 0) {
    throw new MoxxyError({ code: 'AUTH_INVALID', message: `Claude CLI logout failed${result.stderr ? `: ${result.stderr}` : '.'}` });
  }
  return true;
}

export async function claudeStatus(_ctx: ProviderAuthContext): Promise<ProviderOAuthStatus | null> {
  const status = await checkClaudeCliAuth();
  return {
    accountId: status.accountId ?? null,
    authState: status.state,
    message: status.message,
  };
}

function parseStatusOutput(output: string): { loggedIn: boolean; accountId?: string } | null {
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    const loggedIn = value.loggedIn ?? value.logged_in ?? value.authenticated;
    if (typeof loggedIn !== 'boolean') return null;
    const account = value.email ?? value.account ?? value.accountEmail ?? value.account_email;
    return { loggedIn, ...(typeof account === 'string' && account ? { accountId: account } : {}) };
  } catch {
    const text = output.trim();
    if (/not logged in|signed out|not authenticated/i.test(text)) return { loggedIn: false };
    if (/logged in|authenticated|signed in/i.test(text)) {
      const email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
      return { loggedIn: true, ...(email ? { accountId: email } : {}) };
    }
    return null;
  }
}

function looksUnsupported(text: string): boolean {
  return /unknown (command|option)|invalid (command|option)|unrecognized (command|option)|not supported/i.test(text);
}

function authError(status: ClaudeCliAuthStatus): MoxxyError {
  return new MoxxyError({
    code: status.state === 'signed-out' ? 'AUTH_NO_CREDENTIALS' : 'AUTH_INVALID',
    message: status.message,
    hint: status.state === 'signed-out' ? 'Run `moxxy login claude-code`.' : undefined,
    context: { provider: CLAUDE_CODE_PROVIDER_ID, executable: status.executable, state: status.state },
  });
}

async function runCommand(
  executable: string,
  args: readonly string[],
  options: { readonly inherit?: boolean } = {},
): Promise<ClaudeCommandResult> {
  return await new Promise((resolve) => {
    const spawnOptions: SpawnOptions = options.inherit
      ? { stdio: 'inherit' }
      : { stdio: ['ignore', 'pipe', 'pipe'] };
    const child = spawn(executable, [...args], spawnOptions);
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error: NodeJS.ErrnoException) => resolve({ code: 1, stdout, stderr, error }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
