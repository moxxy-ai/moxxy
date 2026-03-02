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
import { COMMAND_HELP, showHelp } from './help.js';
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


function hasHelpFlag(args) {
  return args.includes('--help') || args.includes('-h');
}

async function routeCommand(client, command, rest) {
  const helpKey = command === 'chat' ? 'tui' : command;
  if (hasHelpFlag(rest) && COMMAND_HELP[helpKey]) {
    showHelp(helpKey, p);
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
