/**
 * Whether a tool call an agent connection ran itself operates the person's computer, recognised
 * by the tool's name, so every surface can say the agent is using the computer and offer Stop.
 */

export interface AgentComputerUse {
  /** The app the call names, `null` when it names none (listing apps, a screenshot of the screen). */
  readonly app: string | null;
}

/**
 * A computer-use MCP server's tools, which drive the person's apps: `mcp__computer-use__click` from
 * Claude Code and Codex, `computer-use_click` from OpenCode (which names MCP tools `server_tool`).
 */
const COMPUTER_SERVERS = /^(?:mcp__)?computer[-_]use_/;
/** Codex's computer use as JavaScript against its `cua` API; the same API also drives Codex's own browser. */
const CUA_JS = 'mcp__cua_repl__js';
const CUA_APPS = /\bcua\.(getApp|getState|listApps|listWindows)\s*\(/;
const CUA_APP_NAME = /\bcua\.getApp\(\s*['"`]([^'"`]+)['"`]/;

export function agentComputerUseOf(name: string, input: unknown): AgentComputerUse | undefined {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  if (COMPUTER_SERVERS.test(name)) {
    return { app: typeof fields.app === 'string' && fields.app.length > 0 ? fields.app : null };
  }
  if (name !== CUA_JS || typeof fields.code !== 'string' || !CUA_APPS.test(fields.code)) return undefined;
  const named = CUA_APP_NAME.exec(fields.code);
  return { app: named && named[1] ? named[1] : null };
}
