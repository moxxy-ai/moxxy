#!/usr/bin/env node

import { createApiClient } from './api-client.js';
import { isInteractive, handleCancel, p } from './ui.js';
import { runInit, readAuthMode } from './commands/init.js';
import { runAuth } from './commands/auth.js';
import { runAgent } from './commands/agent.js';
import { runProvider } from './commands/provider.js';
import { runSkill } from './commands/skill.js';
import { runHeartbeat } from './commands/heartbeat.js';
import { runVault } from './commands/vault.js';
import { runEvents } from './commands/events.js';
import { runGateway } from './commands/gateway.js';
import { runDoctor } from './commands/doctor.js';
import { runUninstall } from './commands/uninstall.js';
import { runUpdate } from './commands/update.js';
import { runChannel } from './commands/channel.js';
import chalk from 'chalk';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

export const LOGO = `
  ███╗   ███╗ ██████╗ ██╗  ██╗██╗  ██╗██╗   ██╗
  ████╗ ████║██╔═══██╗╚██╗██╔╝╚██╗██╔╝╚██╗ ██╔╝
  ██╔████╔██║██║   ██║ ╚███╔╝  ╚███╔╝  ╚████╔╝
  ██║╚██╔╝██║██║   ██║ ██╔██╗  ██╔██╗   ╚██╔╝
  ██║ ╚═╝ ██║╚██████╔╝██╔╝ ██╗██╔╝ ██╗   ██║
  ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝
  ${chalk.italic.dim('Agents that work while you sleep.')}  ${chalk.gray(`v${version}`)}
`;

const HELP = `${LOGO}
  Agentic Framework CLI

Usage:
  moxxy                                               Interactive menu
  moxxy init                                          First-time setup wizard
  moxxy tui [--agent <id>]                            Full-screen chat interface
  moxxy chat [--agent <id>]                           Alias for tui
  moxxy auth token create [--scopes <s>] [--ttl <n>] [--json]
  moxxy auth token list [--json]
  moxxy auth token revoke <id>
  moxxy agent create --provider <p> --model <m> --workspace <w> [--json]
  moxxy agent run --id <id> --task "task" [--json]
  moxxy agent stop --id <id>
  moxxy agent status --id <id> [--json]
  moxxy provider list
  moxxy skill import --agent <id> --name <n> --content <c>
  moxxy skill approve --agent <id> --skill <id>
  moxxy heartbeat set --agent <id> --interval <n> [--action_type <t>]
  moxxy heartbeat list --agent <id>
  moxxy vault add --key <k> --backend <b>
  moxxy vault grant --agent <id> --secret <id>
  moxxy channel create                              Create a channel (Telegram/Discord)
  moxxy channel list                                List channels
  moxxy channel pair --code <code> --agent <id>     Pair a chat to an agent
  moxxy channel delete <id>                         Delete a channel
  moxxy channel bindings <id>                       List bindings for a channel
  moxxy channel unbind <channel-id> <binding-id>    Unbind a chat
  moxxy events tail [--agent <id>] [--run <id>] [--json]
  moxxy gateway start                                Start the gateway
  moxxy gateway stop                                 Stop the gateway
  moxxy gateway restart                              Restart the gateway
  moxxy gateway status                               Show gateway status
  moxxy gateway logs                                 Tail gateway logs
  moxxy doctor                                       Diagnose installation
  moxxy update [--check] [--force] [--json]          Check for and install updates
  moxxy update --rollback                            Restore previous gateway version
  moxxy uninstall                                    Remove all Moxxy data

Environment:
  MOXXY_API_URL   API base URL (default: http://localhost:3000)
  MOXXY_TOKEN     API token for authentication
`.trim();

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
  --id <id>            Agent ID (run/stop/status/update/delete)
  --task <text>        Task description (run only)
  --policy <profile>   Policy profile name (create only)
  --json               Output as JSON

Examples:
  moxxy agent create --name my-agent --provider openai --model gpt-4o
  moxxy agent run --id <agent-id> --task "Summarize the README"
  moxxy agent status --id <agent-id> --json
  moxxy agent stop --id <agent-id>
  moxxy agent update --id <agent-id> --model gpt-4o-mini
  moxxy agent delete --id <agent-id>`,

  provider: `Usage: moxxy provider <action> [options]

Manage LLM providers.

Actions:
  install   Add a built-in or custom provider
  list      Show installed providers

Options:
  --id <id>          Provider ID for install (e.g. openai, anthropic, xai)
  --model <id>       Custom model ID to add
  --name <name>      Display name (custom providers)
  --api_base <url>   API base URL (custom providers)
  --json             Output as JSON

Built-in providers:
  anthropic   Anthropic (Claude models)
  openai      OpenAI (GPT models)
  xai         xAI (Grok models)
  google      Google (Gemini models)
  deepseek    DeepSeek

Examples:
  moxxy provider list
  moxxy provider install --id openai
  moxxy provider install --id anthropic --model claude-sonnet-4-20250514`,

  skill: `Usage: moxxy skill <action> [options]

Import and manage agent skills.

Actions:
  import    Install a skill on an agent
  approve   Approve a quarantined skill
  remove    Remove a skill from an agent
  list      List skills for an agent

Options:
  --agent <id>     Agent ID
  --skill <id>     Skill ID (approve/remove)
  --name <name>    Skill name (import)
  --version <v>    Skill version (import, default: 0.1.0)
  --content <c>    Skill content/markdown (import)

Examples:
  moxxy skill import --agent <id> --name web-scraper --content "..."
  moxxy skill approve --agent <id> --skill <skill-id>
  moxxy skill list --agent <id>
  moxxy skill remove --agent <id> --skill <skill-id>`,

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
  - Rust toolchain, Node.js version, Git, Chrome
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

Does NOT remove the CLI npm package itself. To fully remove:
  npm uninstall -g moxxy-cli`,

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

function hasHelpFlag(args) {
  return args.includes('--help') || args.includes('-h');
}

async function routeCommand(client, command, rest) {
  const helpKey = command === 'chat' ? 'tui' : command;
  if (hasHelpFlag(rest) && COMMAND_HELP[helpKey]) {
    console.log(COMMAND_HELP[helpKey]);
    return;
  }

  switch (command) {
    case 'init':
      await runInit(client, rest);
      break;
    case 'auth':
      await runAuth(client, rest);
      break;
    case 'agent':
      await runAgent(client, rest);
      break;
    case 'provider':
      await runProvider(client, rest);
      break;
    case 'skill':
      await runSkill(client, rest);
      break;
    case 'heartbeat':
      await runHeartbeat(client, rest);
      break;
    case 'vault':
      await runVault(client, rest);
      break;
    case 'events':
      await runEvents(client, rest);
      break;
    case 'gateway':
      await runGateway(client, rest);
      break;
    case 'doctor':
      await runDoctor(client, rest);
      break;
    case 'channel':
      await runChannel(client, rest);
      break;
    case 'update':
      await runUpdate(client, rest);
      break;
    case 'uninstall':
      await runUninstall(client, rest);
      break;
    case 'tui':
    case 'chat': {
      const { startTui } = await import('./tui/index.js');
      await startTui(client, rest);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

async function main() {
  const [,, command, ...rest] = process.argv;

  if (command === '--version' || command === '-V') {
    console.log(`moxxy v${version}`);
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  const baseUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  const authMode = readAuthMode();
  const token = process.env.MOXXY_TOKEN || '';
  const client = createApiClient(baseUrl, token, authMode);

  if (!command && isInteractive()) {
    console.log(LOGO);
    p.intro();

    const selected = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'tui',      label: 'Chat',      hint: 'full-screen TUI' },
        { value: 'init',      label: 'Init',      hint: 'first-time setup' },
        { value: 'auth',      label: 'Auth',      hint: 'manage API tokens' },
        { value: 'agent',     label: 'Agent',     hint: 'create & manage agents' },
        { value: 'provider',  label: 'Provider',  hint: 'list providers' },
        { value: 'skill',     label: 'Skill',     hint: 'import & manage skills' },
        { value: 'heartbeat', label: 'Heartbeat', hint: 'schedule heartbeat rules' },
        { value: 'vault',     label: 'Vault',     hint: 'manage secrets' },
        { value: 'channel',   label: 'Channel',   hint: 'manage Telegram/Discord channels' },
        { value: 'events',    label: 'Events',    hint: 'stream live events' },
        { value: 'gateway',   label: 'Gateway',   hint: 'start/stop/manage gateway' },
        { value: 'doctor',    label: 'Doctor',    hint: 'diagnose installation' },
        { value: 'update',    label: 'Update',    hint: 'check for and install updates' },
        { value: 'uninstall', label: 'Uninstall', hint: 'remove all Moxxy data' },
      ],
    });
    handleCancel(selected);

    try {
      await routeCommand(client, selected, []);
    } catch (err) {
      if (err.isGatewayDown) {
        p.log.info(err.message);
      } else {
        p.log.error(err.message);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (!command) {
    console.log(HELP);
    return;
  }

  try {
    await routeCommand(client, command, rest);
  } catch (err) {
    if (err.isGatewayDown) {
      console.log(err.message);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exitCode = 1;
  }
}

main();
