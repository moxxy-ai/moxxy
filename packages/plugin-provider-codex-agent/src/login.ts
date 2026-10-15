import { MoxxyError } from '@moxxy/sdk';
import { spawnExecutableTarget } from '@moxxy/sdk/server';
import type { AgentSignIn } from '@moxxy/agent-connection-kit';
import type { ProviderAuthContext, ProviderOAuthResult, ProviderOAuthStatus } from '@moxxy/sdk';
import {
  CODEX_AGENT_PROVIDER_ID,
  CODEX_EXECUTABLE_ENV,
  CODEX_LOGIN_ARGS,
  CODEX_LOGIN_STATUS_ARGS,
  CODEX_LOGOUT_ARGS,
} from './constants.js';
import { codexTarget } from './executable.js';

export type CodexAuthState = 'signed-in' | 'signed-out' | 'missing' | 'error';

export interface CodexAuthStatus {
  readonly state: CodexAuthState;
  readonly executable: string;
  /** How Codex is signed in (`ChatGPT`, `an API key`); Codex does not print the account. */
  readonly accountId?: string;
  readonly message: string;
}

export interface CodexCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: NodeJS.ErrnoException;
}

interface CommandOptions {
  /** Hand Codex the terminal (a CLI login). */
  readonly inherit?: boolean;
  /** See Codex's output as it comes (a GUI login, to find the sign-in page). */
  readonly onOutput?: (chunk: string) => void;
}

type CommandRunner = (executable: string, args: readonly string[], options?: CommandOptions) => Promise<CodexCommandResult>;

const SIGN_IN_PAGE = /https:\/\/auth\.openai\.com\/\S+/;

let runCommandImpl: CommandRunner = runCommand;
/** Test seam. */
export function __setCodexCommandRunner(runner: CommandRunner): void {
  runCommandImpl = runner;
}

export function resolveCodexExecutable(config: Readonly<Record<string, unknown>> = {}): string {
  const configured = config.executable;
  if (typeof configured === 'string' && configured.trim()) return configured;
  return process.env[CODEX_EXECUTABLE_ENV]?.trim() || 'codex';
}

/** Read the sign-in from the person's own Codex (`codex login status`); Moxxy never touches its tokens. */
export async function checkCodexAuth(executable = resolveCodexExecutable()): Promise<CodexAuthStatus> {
  const result = await runCommandImpl(executable, CODEX_LOGIN_STATUS_ARGS);
  if (result.error?.code === 'ENOENT') {
    return { state: 'missing', executable, message: `Codex CLI not found: ${executable}. Install Codex or set ${CODEX_EXECUTABLE_ENV}.` };
  }
  if (result.error) return { state: 'error', executable, message: `Could not run Codex: ${result.error.message}` };
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (/not logged in/i.test(text)) {
    return { state: 'signed-out', executable, message: `Codex is installed but signed out. Run \`moxxy login ${CODEX_AGENT_PROVIDER_ID}\`.` };
  }
  const using = /logged in using (.+)/i.exec(text);
  if (using?.[1] && result.code === 0) {
    const accountId = using[1].trim();
    return { state: 'signed-in', executable, accountId, message: `Codex is signed in using ${accountId}.` };
  }
  return { state: 'error', executable, message: `Codex login status failed${text ? `: ${text}` : ` with exit code ${result.code}`}.` };
}

/** Who Codex is signed in as, for the connection's row. */
export async function codexSignIn(executable = resolveCodexExecutable()): Promise<AgentSignIn> {
  const status = await checkCodexAuth(executable);
  return { signedIn: status.state === 'signed-in', ...(status.accountId ? { account: status.accountId } : {}) };
}

export async function codexLogin(ctx: ProviderAuthContext): Promise<ProviderOAuthResult> {
  const executable = resolveCodexExecutable(ctx.providerConfig);
  let status = await checkCodexAuth(executable);
  if (status.state === 'signed-in') return { accountId: status.accountId ?? null };
  if (status.state !== 'signed-out') throw authError(status);

  // A GUI host (the desktop) has no terminal: show Codex's output and let the host open the sign-in page.
  let opened = false;
  const login = await runCommandImpl(
    executable,
    CODEX_LOGIN_ARGS,
    ctx.noOpen
      ? {
          onOutput: (chunk) => {
            ctx.write(chunk);
            const page = SIGN_IN_PAGE.exec(chunk);
            if (page && !opened) {
              opened = true;
              ctx.onAuthUrl?.(page[0]);
            }
          },
        }
      : { inherit: true },
  );
  if (login.error) throw authError({ state: login.error.code === 'ENOENT' ? 'missing' : 'error', executable, message: login.error.message });
  if (login.code !== 0) {
    throw new MoxxyError({
      code: 'AUTH_DENIED',
      message: `Codex login failed${login.stderr ? `: ${login.stderr.trim()}` : ` with exit code ${login.code}`}.`,
      hint: 'Run `codex login` directly for more detail, then retry.',
      context: { provider: CODEX_AGENT_PROVIDER_ID },
    });
  }
  status = await checkCodexAuth(executable);
  if (status.state !== 'signed-in') throw authError(status);
  return { accountId: status.accountId ?? null };
}

export async function codexLogout(ctx: ProviderAuthContext): Promise<boolean> {
  const executable = resolveCodexExecutable(ctx.providerConfig);
  const before = await checkCodexAuth(executable);
  if (before.state !== 'signed-in') return false;
  const result = await runCommandImpl(executable, CODEX_LOGOUT_ARGS, { inherit: true });
  if (result.error || result.code !== 0) {
    throw new MoxxyError({ code: 'AUTH_INVALID', message: `Codex logout failed${result.stderr ? `: ${result.stderr}` : '.'}` });
  }
  return true;
}

export async function codexStatus(ctx: ProviderAuthContext): Promise<ProviderOAuthStatus | null> {
  const status = await checkCodexAuth(resolveCodexExecutable(ctx.providerConfig));
  return { accountId: status.accountId ?? null, authState: status.state, message: status.message };
}

export function authError(status: CodexAuthStatus): MoxxyError {
  return new MoxxyError({
    code: status.state === 'signed-out' ? 'AUTH_NO_CREDENTIALS' : 'AUTH_INVALID',
    message: status.message,
    hint: status.state === 'signed-out' ? `Run \`moxxy login ${CODEX_AGENT_PROVIDER_ID}\`.` : undefined,
    context: { provider: CODEX_AGENT_PROVIDER_ID, executable: status.executable, state: status.state },
  });
}

async function runCommand(executable: string, args: readonly string[], options: CommandOptions = {}): Promise<CodexCommandResult> {
  let target;
  try {
    target = codexTarget(executable);
  } catch (err) {
    const error = Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'ENOENT' }) as NodeJS.ErrnoException;
    return { code: 1, stdout: '', stderr: '', error };
  }
  return await new Promise((resolve) => {
    const child = spawnExecutableTarget(target, [...args], options.inherit ? { stdio: 'inherit' } : { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      options.onOutput?.(chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      options.onOutput?.(chunk);
    });
    child.once('error', (error: NodeJS.ErrnoException) => resolve({ code: 1, stdout, stderr, error }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
