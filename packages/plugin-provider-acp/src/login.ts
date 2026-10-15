import type { AgentSignIn } from '@moxxy/agent-connection-kit';
import { MoxxyError } from '@moxxy/sdk';
import { spawnExecutableTarget } from '@moxxy/sdk/server';
import type { ProviderAuthContext, ProviderOAuthResult, ProviderOAuthStatus } from '@moxxy/sdk';
import {
  OPENCODE_DEBUG_AGENT_ARGS,
  OPENCODE_DEBUG_CONFIG_ARGS,
  OPENCODE_AUTH_LIST_ARGS,
  OPENCODE_AUTH_LOGIN_ARGS,
  OPENCODE_AUTH_LOGOUT_ARGS,
  OPENCODE_EXECUTABLE_ENV,
  OPENCODE_MODELS_ARGS,
  OPENCODE_PROVIDER_ID,
} from './constants.js';
import { opencodeTarget } from './executable.js';
import type { OpenCodeRule, ReadAgentMcpServers, ReadAgentRules } from './rules.js';

export type OpenCodeState = 'signed-in' | 'missing' | 'error';

export interface OpenCodeStatus {
  readonly state: OpenCodeState;
  readonly executable: string;
  /** The model providers OpenCode is signed in to (`OpenAI, Anthropic`). */
  readonly accountId?: string;
  readonly message: string;
}

export interface OpenCodeCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: NodeJS.ErrnoException;
}

interface CommandOptions {
  /** Hand OpenCode the terminal (its interactive provider picker). */
  readonly inherit?: boolean;
  /** Where OpenCode runs, so the project's own config applies. */
  readonly cwd?: string;
}

type CommandRunner = (executable: string, args: readonly string[], options?: CommandOptions) => Promise<OpenCodeCommandResult>;

const ANSI = /\u001b\[[0-9;]*m/g;
const CREDENTIAL = /^●\s+(.+?)\s+\S+$/;
const MODEL_ID = /^[\w.@-]+\/\S+$/;
const LOGIN_HINT = 'Run `opencode auth login` in a terminal to sign OpenCode in to a model provider.';

let runCommandImpl: CommandRunner = runCommand;
/** Test seam. */
export function __setOpenCodeCommandRunner(runner: CommandRunner): void {
  runCommandImpl = runner;
}

export function resolveOpenCodeExecutable(config: Readonly<Record<string, unknown>> = {}): string {
  const configured = config.executable;
  if (typeof configured === 'string' && configured.trim()) return configured;
  return process.env[OPENCODE_EXECUTABLE_ENV]?.trim() || 'opencode';
}

/**
 * Whether the person's OpenCode can work, read from `opencode auth list`.
 * Installed is enough: OpenCode's free models need no sign-in, and the
 * providers it is signed in to are named. Moxxy never touches its tokens.
 */
export async function checkOpenCode(executable = resolveOpenCodeExecutable()): Promise<OpenCodeStatus> {
  const result = await runCommandImpl(executable, OPENCODE_AUTH_LIST_ARGS);
  if (result.error?.code === 'ENOENT') {
    return { state: 'missing', executable, message: `OpenCode not found: ${executable}. Install OpenCode or set ${OPENCODE_EXECUTABLE_ENV}.` };
  }
  if (result.error || result.code !== 0) {
    const detail = result.error?.message ?? (result.stderr.trim() || `exit code ${result.code}`);
    return { state: 'error', executable, message: `Could not run OpenCode: ${detail}` };
  }
  const providers = result.stdout
    .replace(ANSI, '')
    .split('\n')
    .flatMap((line) => {
      const match = CREDENTIAL.exec(line.trim());
      return match?.[1] ? [match[1]] : [];
    });
  if (providers.length === 0) {
    return { state: 'signed-in', executable, message: `OpenCode is ready with its free models. ${LOGIN_HINT}` };
  }
  const accountId = providers.join(', ');
  return { state: 'signed-in', executable, accountId, message: `OpenCode is ready, signed in to ${accountId}.` };
}

/** Who OpenCode is signed in to, for the connection's row; its free models need no sign-in. */
export async function openCodeSignIn(executable = resolveOpenCodeExecutable()): Promise<AgentSignIn> {
  const status = await checkOpenCode(executable);
  return { signedIn: status.state === 'signed-in', ...(status.accountId ? { account: status.accountId } : {}) };
}

/** The models the person's OpenCode offers (`opencode models`); none when it cannot say. */
export async function listOpenCodeModels(executable = resolveOpenCodeExecutable()): Promise<string[]> {
  const result = await runCommandImpl(executable, OPENCODE_MODELS_ARGS);
  if (result.error || result.code !== 0) return [];
  return result.stdout
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => MODEL_ID.test(line));
}

/** The rules of one of the person's OpenCode agents (`opencode debug agent <name>`), read where the conversation runs. */
export function readOpenCodeRules(executable = resolveOpenCodeExecutable()): ReadAgentRules {
  return async ({ cwd, agent }) => {
    const result = await runCommandImpl(executable, [...OPENCODE_DEBUG_AGENT_ARGS, agent], { cwd });
    if (result.error || result.code !== 0) return undefined;
    try {
      const { permission } = JSON.parse(result.stdout) as { permission?: unknown };
      return Array.isArray(permission) ? permission.filter(isRule) : undefined;
    } catch {
      return undefined;
    }
  };
}

/** The person's own MCP servers that are on, from the config OpenCode resolves in `cwd` (`opencode debug config`). */
export function readOpenCodeMcpServers(executable = resolveOpenCodeExecutable()): ReadAgentMcpServers {
  return async ({ cwd }) => {
    const result = await runCommandImpl(executable, [...OPENCODE_DEBUG_CONFIG_ARGS], { cwd });
    if (result.error || result.code !== 0) return undefined;
    try {
      const { mcp } = JSON.parse(result.stdout) as { mcp?: Record<string, { enabled?: unknown } | null> };
      return Object.entries(mcp ?? {}).flatMap(([name, server]) => (server?.enabled === false ? [] : [name]));
    } catch {
      return undefined;
    }
  };
}

function isRule(value: unknown): value is OpenCodeRule {
  const rule = value as Partial<OpenCodeRule> | null;
  return (
    typeof rule === 'object' && rule !== null && typeof rule.permission === 'string' && typeof rule.pattern === 'string'
    && (rule.action === 'allow' || rule.action === 'ask' || rule.action === 'deny')
  );
}

export async function opencodeLogin(ctx: ProviderAuthContext): Promise<ProviderOAuthResult> {
  const executable = resolveOpenCodeExecutable(ctx.providerConfig);
  const before = await checkOpenCode(executable);
  if (before.state !== 'signed-in') throw authError(before);
  // OpenCode asks which provider and how in its own terminal picker; a window cannot answer it.
  if (ctx.noOpen) {
    throw new MoxxyError({
      code: 'AUTH_NO_CREDENTIALS',
      message: 'OpenCode signs in to model providers in a terminal.',
      hint: LOGIN_HINT,
      context: { provider: OPENCODE_PROVIDER_ID },
    });
  }
  const login = await runCommandImpl(executable, OPENCODE_AUTH_LOGIN_ARGS, { inherit: true });
  if (login.error) throw authError({ state: login.error.code === 'ENOENT' ? 'missing' : 'error', executable, message: login.error.message });
  if (login.code !== 0) {
    throw new MoxxyError({
      code: 'AUTH_DENIED',
      message: `OpenCode login failed with exit code ${login.code}.`,
      hint: 'Run `opencode auth login` directly for more detail, then retry.',
      context: { provider: OPENCODE_PROVIDER_ID },
    });
  }
  const after = await checkOpenCode(executable);
  if (after.state !== 'signed-in') throw authError(after);
  return { accountId: after.accountId ?? null };
}

export async function opencodeLogout(ctx: ProviderAuthContext): Promise<boolean> {
  const executable = resolveOpenCodeExecutable(ctx.providerConfig);
  const before = await checkOpenCode(executable);
  if (before.state !== 'signed-in' || before.accountId === undefined) return false;
  if (ctx.noOpen) {
    throw new MoxxyError({
      code: 'AUTH_INVALID',
      message: 'OpenCode signs out of model providers in a terminal.',
      hint: 'Run `opencode auth logout` in a terminal.',
      context: { provider: OPENCODE_PROVIDER_ID },
    });
  }
  const result = await runCommandImpl(executable, OPENCODE_AUTH_LOGOUT_ARGS, { inherit: true });
  if (result.error || result.code !== 0) {
    throw new MoxxyError({ code: 'AUTH_INVALID', message: `OpenCode logout failed${result.stderr ? `: ${result.stderr}` : '.'}` });
  }
  return true;
}

export async function opencodeStatus(ctx: ProviderAuthContext): Promise<ProviderOAuthStatus | null> {
  const status = await checkOpenCode(resolveOpenCodeExecutable(ctx.providerConfig));
  return { accountId: status.accountId ?? null, authState: status.state, message: status.message };
}

export function authError(status: OpenCodeStatus): MoxxyError {
  return new MoxxyError({
    code: 'AUTH_INVALID',
    message: status.message,
    context: { provider: OPENCODE_PROVIDER_ID, executable: status.executable, state: status.state },
  });
}

async function runCommand(executable: string, args: readonly string[], options: CommandOptions = {}): Promise<OpenCodeCommandResult> {
  let target;
  try {
    target = opencodeTarget(executable);
  } catch (err) {
    const error = Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'ENOENT' }) as NodeJS.ErrnoException;
    return { code: 1, stdout: '', stderr: '', error };
  }
  return await new Promise((resolve) => {
    const where = options.cwd ? { cwd: options.cwd } : {};
    const child = spawnExecutableTarget(target, [...args], options.inherit ? { ...where, stdio: 'inherit' } : { ...where, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.on('data', (chunk: string) => (stderr += chunk));
    child.once('error', (error: NodeJS.ErrnoException) => resolve({ code: 1, stdout, stderr, error }));
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
