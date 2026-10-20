import { existsSync } from 'node:fs';
import path from 'node:path';
import { CLAUDE_CLI, findAgentCli } from '@moxxy/agent-connection-kit';

/**
 * The file the Agent SDK should start for the person's Claude Code. A Windows
 * npm install puts a `.cmd` shim on PATH, which only a shell can run, so the
 * `cli.js` it points at is used instead.
 */
export function claudeExecutableForSdk(
  found: string,
  exists: (file: string) => boolean = existsSync,
  paths: Pick<typeof path, 'extname' | 'dirname' | 'join'> = path,
): string {
  const extension = paths.extname(found).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat' && extension !== '.ps1') return found;
  const cli = paths.join(paths.dirname(found), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  if (exists(cli)) return cli;
  throw new Error(`Cannot find the Claude Code cli.js behind ${found}; reinstall Claude Code or point CLAUDE_CODE_EXECUTABLE at the CLI.`);
}

/**
 * The person's Claude Code CLI as an absolute path for the SDK — on PATH, or
 * where Claude's installer puts it — or `undefined` when it is not installed.
 */
export function resolveClaudeForSdk(command: string): string | undefined {
  const found = findAgentCli(CLAUDE_CLI, { command });
  return found ? claudeExecutableForSdk(found) : undefined;
}

/** The SDK's file for the configured command: a path as given (shim resolved), a bare name looked up. */
export function claudeForSdk(command: string): string | undefined {
  return command.includes('/') || command.includes('\\') ? claudeExecutableForSdk(command) : resolveClaudeForSdk(command);
}
