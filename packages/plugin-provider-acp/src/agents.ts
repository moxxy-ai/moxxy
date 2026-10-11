import { MOXXY_MCP_SERVER, OPENCODE_DEFAULT_MODEL, OPENCODE_PROVIDER_ID } from './constants.js';

/** What differs between agents that speak ACP. OpenCode is the only one so far. */
export interface AcpAgentSpec {
  readonly providerId: string;
  /** The agent's name in messages ("OpenCode stopped."). */
  readonly label: string;
  readonly defaultModel: string;
  /** The name Moxxy's MCP server has in the agent's session. */
  readonly mcpServerName: string;
  /** How the agent names a tool of Moxxy's MCP server: those calls are recorded by Moxxy when it runs them. */
  readonly moxxyToolPrefix: string;
  /** Moxxy tools the agent has its own of, so they are not lent over MCP. */
  readonly ownTools: ReadonlySet<string>;
  /** What the person runs to sign the agent in to a model provider. */
  readonly loginCommand: string;
}

/**
 * OpenCode (`opencode acp`). It has its own file, shell, web-fetch, todo,
 * skill and sub-agent tools. It has no question tool over ACP, no plan hand-off
 * and no goal, so Moxxy lends `ask_user`, `plan_complete` and the goal tools.
 */
export const OPENCODE_AGENT: AcpAgentSpec = {
  providerId: OPENCODE_PROVIDER_ID,
  label: 'OpenCode',
  defaultModel: OPENCODE_DEFAULT_MODEL,
  mcpServerName: MOXXY_MCP_SERVER,
  moxxyToolPrefix: `${MOXXY_MCP_SERVER}_`,
  ownTools: new Set([
    'Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Sleep', 'Wait', 'StopJob',
    'web_fetch', 'recall', 'session_recall',
    'load_skill', 'reload_skills', 'synthesize_skill', 'load_tool',
  ]),
  loginCommand: 'opencode auth login',
};
