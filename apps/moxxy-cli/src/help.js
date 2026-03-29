export const COMMAND_HELP = {
  init: `Usage: moxxy init

First-time setup wizard. Configures the Moxxy home directory, auth mode,
API token, and optional channel setup.

Steps:
  1. Creates ~/.moxxy directory structure
  2. Configures gateway URL
  3. Selects auth mode (token or loopback)
  4. Bootstraps an API token
  5. Optionally sets up a Telegram/Discord channel`,

  auth: `Usage: moxxy auth token <action> [options]

Manage API tokens for gateway authentication.

Actions:
  create    Create a new API token
  list      List all tokens
  revoke    Revoke an existing token

Options:
  --scopes <s>       Comma-separated scopes (e.g. "*", "agents:read,runs:write")
  --ttl <seconds>    Token time-to-live in seconds (omit for no expiry)
  --description <d>  Optional token description
  --json             Output as JSON

Valid scopes:
  *  agents:read  agents:write  runs:write  vault:read  vault:write
  tokens:admin  events:read  channels:read  channels:write

Examples:
  moxxy auth token create --scopes "*"
  moxxy auth token create --scopes "agents:read,runs:write" --ttl 86400
  moxxy auth token list --json
  moxxy auth token revoke <token-id>`,

  agent: `Usage: moxxy agent <action> [options]

Create and manage agents.

Actions:
  create    Provision a new agent
  run       Start a task run on an agent
  stop      Stop a running agent
  status    Check agent status
  update    Change provider, model, or temperature
  delete    Permanently remove an agent

Options:
  --provider <id>      Provider ID (e.g. openai, anthropic)
  --model <id>         Model ID (e.g. gpt-4o, claude-sonnet-4-20250514)
  --name <name>        Agent name (create only)
  --persona <text>     Agent persona/system prompt (create only)
  --temperature <n>    Sampling temperature (default: 0.7)
  --id <name>          Agent name (run/stop/status/update/delete)
  --task <text>        Task description (run only)
  --policy <profile>   Policy profile name (create only)
  --json               Output as JSON

Examples:
  moxxy agent create --name my-agent --provider openai --model gpt-4o
  moxxy agent run --id my-agent --task "Summarize the README"
  moxxy agent status --id my-agent --json
  moxxy agent stop --id my-agent
  moxxy agent update --id my-agent --model gpt-4o-mini
  moxxy agent delete --id my-agent`,

  provider: `Usage: moxxy provider <action> [options]

Manage LLM providers.

Actions:
  install   Add a built-in or custom provider
  login     OAuth/subscription login (currently openai-codex)
  list      Show installed providers

Options:
  --id <id>          Provider ID for install (e.g. openai, anthropic, xai)
  --method <m>       Login method for OAuth providers: browser | headless
  --no-browser       Do not auto-open browser (print URL only)
  --originator <id>  Advanced: override OAuth originator (default: Codex Desktop)
  --allowed_workspace_id <id>  Advanced: constrain browser OAuth to a workspace/org id
  --organization_id <id>       Advanced: pass explicit organization id in OAuth URL
  --project_id <id>            Advanced: pass explicit project id in OAuth URL
  --api_key <key>              Fallback: manually provide OpenAI API key if OAuth issuance fails
  (automatic fallback)         If API-key issuance fails, uses ChatGPT OAuth session mode
  --model <id>       Custom model ID to add
  --name <name>      Display name (custom providers)
  --api_base <url>   API base URL (custom providers)
  --json             Output as JSON

Built-in providers:
  anthropic   Anthropic (Claude models)
  openai      OpenAI (GPT models)
  openai-codex OpenAI subscription OAuth login
  xai         xAI (Grok models)
  google      Google (Gemini models)
  deepseek    DeepSeek

Examples:
  moxxy provider list
  moxxy provider install --id openai
  moxxy provider login --id openai-codex --method browser
  moxxy provider login --id openai-codex --method headless --no-browser
  moxxy provider login --id openai-codex --method browser --api_key sk-...
  moxxy provider install --id anthropic --model claude-sonnet-4-20250514`,

  skill: `Usage: moxxy skill <action> [options]

Create and manage agent skills.

Actions:
  create    Create a skill on an agent
  remove    Remove a skill from an agent
  list      List skills for an agent

Options:
  --agent <id>     Agent ID
  --skill <id>     Skill ID (remove)
  --content <c>    Skill content/markdown (create)

Examples:
  moxxy skill create --agent <id> --content "..."
  moxxy skill list --agent <id>
  moxxy skill remove --agent <id> --skill <skill-id>`,

  template: `Usage: moxxy template <action> [options]

Manage agent templates (archetypes).

Actions:
  list      List all templates
  get       View template details
  create    Create a new template
  update    Update an existing template
  remove    Delete a template
  assign    Assign a template to an agent

Options:
  --slug <slug>      Template slug (get/update/remove)
  --content <c>      Template content (create/update)
  --agent <id>       Agent ID (assign)
  --template <slug>  Template slug (assign)

Examples:
  moxxy template list
  moxxy template get builder
  moxxy template create --content "---\\nname: Custom\\n..."
  moxxy template assign --agent my-agent --template builder
  moxxy template remove builder`,

  heartbeat: `Usage: moxxy heartbeat <action> [options]

Schedule recurring heartbeat rules for agents.

Actions:
  set       Configure a heartbeat rule
  list      Show heartbeat rules for an agent
  disable   Disable a heartbeat rule

Options:
  --agent <id>         Agent ID
  --interval <min>     Interval in minutes (default: 5)
  --action_type <t>    Action type: notify_cli, webhook, restart
  --payload <data>     Webhook URL or payload (webhook action_type)
  --id <id>            Heartbeat ID (disable)

Examples:
  moxxy heartbeat set --agent <id> --interval 10 --action_type notify_cli
  moxxy heartbeat set --agent <id> --interval 30 --action_type webhook --payload https://...
  moxxy heartbeat list --agent <id>
  moxxy heartbeat disable --agent <id> --id <heartbeat-id>`,

  vault: `Usage: moxxy vault <action> [options]

Manage secrets and access grants.

Actions:
  add       Register a new secret reference
  grant     Grant an agent access to a secret
  revoke    Revoke an agent's secret access
  list      Show all secrets and grants

Options:
  --key <name>       Secret key name (e.g. OPENAI_API_KEY)
  --backend <key>    Backend key reference (e.g. env:OPENAI_API_KEY)
  --label <label>    Policy label (optional)
  --agent <id>       Agent ID (grant)
  --secret <id>      Secret ref ID (grant)
  --id <id>          Grant ID (revoke)

Examples:
  moxxy vault add --key OPENAI_API_KEY --backend env:OPENAI_API_KEY
  moxxy vault grant --agent <agent-id> --secret <secret-id>
  moxxy vault list
  moxxy vault revoke --id <grant-id>`,

  channel: `Usage: moxxy channel <action> [options]

Manage messaging channels (Telegram, Discord).

Actions:
  create                              Create a new channel
  list                                List all channels
  pair --code <code> --agent <id>     Pair a chat to an agent
  delete <id>                         Delete a channel
  bindings <id>                       List bindings for a channel
  unbind <channel-id> <binding-id>    Unbind a chat

Options:
  --code <code>    6-digit pairing code from the bot
  --agent <id>     Agent ID to bind
  --json           Output as JSON

Examples:
  moxxy channel create
  moxxy channel list
  moxxy channel pair --code 123456 --agent <agent-id>
  moxxy channel delete <channel-id>
  moxxy channel bindings <channel-id>
  moxxy channel unbind <channel-id> <binding-id>`,

  events: `Usage: moxxy events tail [options]

Stream live events from the gateway via SSE.

Options:
  --agent <id>    Filter events by agent ID
  --run <id>      Filter events by run ID
  --json          Output raw JSON per event

Examples:
  moxxy events tail
  moxxy events tail --agent <agent-id>
  moxxy events tail --agent <agent-id> --json`,

  gateway: `Usage: moxxy gateway <action>

Manage the Moxxy gateway process.

Actions:
  start     Start the gateway (launchd on macOS, systemd on Linux, fallback elsewhere)
  stop      Stop the gateway
  restart   Restart the gateway
  status    Show gateway status and health check
  logs      Tail gateway log output

Examples:
  moxxy gateway start
  moxxy gateway status
  moxxy gateway logs
  moxxy gateway restart
  moxxy gateway stop`,

  doctor: `Usage: moxxy doctor

Diagnose the Moxxy installation. Checks:
  - Moxxy home directory (~/.moxxy)
  - Environment variables (MOXXY_TOKEN, MOXXY_API_URL)
  - Gateway connectivity and health
  - Authentication
  - Installed providers and agents
  - Bun runtime (>= 1.2.0), Rust toolchain, Git, Chrome
  - Provider API keys`,

  update: `Usage: moxxy update [options]

Check for and install updates to the gateway binary and CLI.

Options:
  --check      Check for updates without installing
  --force      Force update even if already up to date
  --rollback   Restore previous gateway binary from backup
  --json       Output as JSON

Examples:
  moxxy update --check
  moxxy update
  moxxy update --force
  moxxy update --rollback`,

  uninstall: `Usage: moxxy uninstall

Remove all Moxxy data from the system. This includes:
  - ~/.moxxy directory (database, agents, config)
  - Stops the gateway if running

Does NOT remove the CLI package itself. To fully remove:
  npm remove -g @moxxy/cli`,

  mcp: `Usage: moxxy mcp <action> [options]

Manage MCP (Model Context Protocol) servers for agents.

Actions:
  list      List MCP servers for an agent
  add       Register a new MCP server
  remove    Remove an MCP server
  test      Test connectivity to an MCP server

Options:
  --agent <name>       Agent name
  --id <id>            MCP server ID
  --transport <type>   Transport type: stdio or sse (add only)
  --command <cmd>      Command to run (stdio transport)
  --args <arg>         Command arguments (stdio, repeatable)
  --url <url>          Server URL (sse transport)

Examples:
  moxxy mcp list --agent my-agent
  moxxy mcp add --agent my-agent --id fs-server --transport stdio --command npx --args -y --args @modelcontextprotocol/server-filesystem --args /tmp
  moxxy mcp add --agent my-agent --id remote --transport sse --url http://localhost:8080/sse
  moxxy mcp remove --agent my-agent --id fs-server
  moxxy mcp test --agent my-agent --id fs-server`,

  tui: `Usage: moxxy tui [options]
       moxxy chat [options]

Full-screen terminal chat interface.

Options:
  --agent <id>    Start with a specific agent pre-selected

Keyboard shortcuts:
  Enter           Send message
  Ctrl+X          Stop running agent
  /help           Show available slash commands
  /quit           Exit the TUI`,
};

/**
 * Show styled help for a command using @clack/prompts.
 * Falls back to console.log if p is not available.
 */
export function showHelp(commandName, p) {
  const text = COMMAND_HELP[commandName];
  if (!text) return;
  p.note(text, `moxxy ${commandName}`);
}
