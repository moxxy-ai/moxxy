import { createApiClient } from './api-client.js';
import { isInteractive, CancelledError, p } from './ui.js';
import { runInit, readAuthMode } from './commands/init.js';
import { runGateway } from './commands/gateway.js';
import { runAuth } from './commands/auth.js';
import { runProvider } from './commands/provider.js';
import { runAgent } from './commands/agent.js';
import { runSkill } from './commands/skill.js';
import { runTemplate } from './commands/template.js';
import { runVault } from './commands/vault.js';
import { runHeartbeat } from './commands/heartbeat.js';
import { runChannel } from './commands/channel.js';
import { runMcp } from './commands/mcp.js';
import { runEvents } from './commands/events.js';
import { runDoctor } from './commands/doctor.js';
import { runUpdate } from './commands/update.js';
import { runUninstall } from './commands/uninstall.js';
import { runPlugin } from './commands/plugin.js';
import { COMMAND_HELP, showHelp } from './help.js';
import chalk from 'chalk';
import { createInterface, cursorTo, clearScreenDown } from 'node:readline';
import pkg from '../package.json' with { type: 'json' };

const { version } = pkg;

export const LOGO = `\n\n\n\n\n
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
  moxxy gateway start                                Start the gateway
  moxxy gateway stop                                 Stop the gateway
  moxxy gateway restart                              Restart the gateway
  moxxy gateway status                               Show gateway status
  moxxy gateway logs                                 Tail gateway logs
  moxxy auth token create [--scopes <s>] [--ttl <n>] [--json]
  moxxy auth token list [--json]
  moxxy auth token revoke <id>
  moxxy provider list
  moxxy provider install --id <provider-id>
  moxxy provider login --id openai-codex --method browser|headless
  moxxy agent create --provider <p> --model <m> --workspace <w> [--json]
  moxxy agent run --id <id> --task "task" [--json]
  moxxy agent stop --id <id>
  moxxy agent status --id <id> [--json]
  moxxy skill create --agent <id> --content <c>
  moxxy skill list --agent <id>
  moxxy template list
  moxxy template get <slug>
  moxxy template create --content <c>
  moxxy template remove <slug>
  moxxy template assign --agent <id> --template <slug>
  moxxy vault add --key <k> --backend <b>
  moxxy vault grant --agent <id> --secret <id>
  moxxy heartbeat set --agent <id> --interval <n> [--action_type <t>]
  moxxy heartbeat list --agent <id>
  moxxy channel create                              Create a channel (Telegram/Discord)
  moxxy channel list                                List channels
  moxxy channel pair --code <code> --agent <id>     Pair a chat to an agent
  moxxy channel delete <id>                         Delete a channel
  moxxy channel bindings <id>                       List bindings for a channel
  moxxy channel unbind <channel-id> <binding-id>    Unbind a chat
  moxxy mcp list --agent <name>                     List MCP servers
  moxxy mcp add --agent <name> --id <id> --transport stdio --command <cmd> [--args ...]
  moxxy mcp add --agent <name> --id <id> --transport sse --url <url>
  moxxy mcp remove --agent <name> --id <id>         Remove an MCP server
  moxxy mcp test --agent <name> --id <id>           Test an MCP server
  moxxy plugin list                                  List installed plugins
  moxxy plugin install <package>                     Install a plugin
  moxxy plugin start <name>                          Start a plugin
  moxxy plugin stop <name>                           Stop a plugin
  moxxy plugin restart <name>                        Restart a plugin
  moxxy plugin uninstall <name>                      Remove a plugin
  moxxy plugin logs <name>                           Tail plugin logs
  moxxy tui [--agent <id>]                            Full-screen chat interface
  moxxy chat [--agent <id>]                           Alias for tui
  moxxy events tail [--agent <id>] [--run <id>] [--json]
  moxxy doctor                                       Diagnose installation
  moxxy update [--check] [--force] [--json]          Check for and install updates
  moxxy update --rollback                            Restore previous gateway version
  moxxy uninstall                                    Remove all Moxxy data

Environment:
  MOXXY_API_URL   API base URL (default: http://localhost:3000)
  MOXXY_TOKEN     API token for authentication
`.trim();


export function clearScreen() {
  if (!isInteractive()) return;
  const rows = process.stdout.rows - 2;
  const blank = rows > 0 ? '\n'.repeat(rows) : '';
  console.log(blank);
  cursorTo(process.stdout, 0, 0);
  clearScreenDown(process.stdout);
}

function waitForEnter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(chalk.dim('\n  Press Enter to continue… '), () => {
      rl.close();
      resolve();
    });
  });
}

function hasHelpFlag(args) {
  return args.includes('--help') || args.includes('-h');
}

async function routeCommand(client, command, rest) {
  const helpKey = command === 'chat' ? 'tui' : command;
  if (hasHelpFlag(rest) && COMMAND_HELP[helpKey]) {
    showHelp(helpKey, p);
    return;
  }

  clearScreen();
  console.log(LOGO);

  switch (command) {
    case 'init':
      await runInit(client, rest);
      break;
    case 'gateway':
      await runGateway(client, rest);
      break;
    case 'auth':
      await runAuth(client, rest);
      break;
    case 'provider':
      await runProvider(client, rest);
      break;
    case 'agent':
      await runAgent(client, rest);
      break;
    case 'skill':
      await runSkill(client, rest);
      break;
    case 'template':
      await runTemplate(client, rest);
      break;
    case 'vault':
      await runVault(client, rest);
      break;
    case 'heartbeat':
      await runHeartbeat(client, rest);
      break;
    case 'channel':
      await runChannel(client, rest);
      break;
    case 'mcp':
      await runMcp(client, rest);
      break;
    case 'plugin':
      await runPlugin(client, rest);
      break;
    case 'tui':
    case 'chat': {
      const { startTui } = await import('./tui/index.jsx');
      await startTui(client, rest);
      break;
    }
    case 'events':
      await runEvents(client, rest);
      break;
    case 'doctor':
      await runDoctor(client, rest);
      break;
    case 'update':
      await runUpdate(client, rest);
      break;
    case 'uninstall':
      await runUninstall(client, rest);
      break;
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

  const MENU_GROUPS = {
    setup:        { label: 'Setup',        hint: 'init, gateway, doctor' },
    agents:       { label: 'Agents',       hint: 'agents, skills, templates' },
    security:     { label: 'Security',     hint: 'auth tokens & secrets' },
    integrations: { label: 'Integrations', hint: 'providers, channels, MCP, plugins' },
    tools:        { label: 'Tools',        hint: 'events stream' },
    system:       { label: 'System',       hint: 'update & uninstall' },
  };

  const SUBMENUS = {
    setup: [
      { value: 'init',      label: 'Init',      hint: 'first-time setup' },
      { value: 'gateway',   label: 'Gateway',   hint: 'start/stop/manage gateway' },
      { value: 'doctor',    label: 'Doctor',    hint: 'diagnose installation' },
    ],
    agents: [
      { value: 'agent',     label: 'Agent',     hint: 'create & manage agents' },
      { value: 'skill',     label: 'Skill',     hint: 'create & manage skills' },
      { value: 'template',  label: 'Template',  hint: 'manage agent templates' },
    ],
    security: [
      { value: 'auth',      label: 'Auth',      hint: 'manage API tokens' },
      { value: 'vault',     label: 'Vault',     hint: 'manage secrets' },
    ],
    integrations: [
      { value: 'provider',  label: 'Provider',  hint: 'list providers' },
      { value: 'channel',   label: 'Channel',   hint: 'manage Telegram/Discord channels' },
      { value: 'mcp',       label: 'MCP',       hint: 'manage MCP servers for agents' },
      { value: 'plugin',    label: 'Plugin',    hint: 'manage plugins & extensions' },
      { value: 'heartbeat', label: 'Heartbeat', hint: 'schedule heartbeat rules' },
    ],
    tools: [
      { value: 'events',    label: 'Events',    hint: 'stream live events' },
    ],
    system: [
      { value: 'update',    label: 'Update',    hint: 'check for and install updates' },
      { value: 'uninstall', label: 'Uninstall', hint: 'remove all Moxxy data' },
    ],
  };

  if (!command && isInteractive()) {
    while (true) {
      clearScreen();
      console.log(LOGO);
      p.intro();

      const selected = await p.select({
        message: 'What would you like to do?',
        options: [
          { value: 'tui', label: 'Chat', hint: 'full-screen TUI' },
          ...Object.entries(MENU_GROUPS).map(([key, { label, hint }]) => ({
            value: key, label, hint,
          })),
        ],
      });

      if (p.isCancel(selected)) {
        p.cancel('Goodbye.');
        break;
      }

      // Chat goes straight to the command
      if (selected === 'tui') {
        try {
          await routeCommand(client, 'tui', []);
          continue;
        } catch (err) {
          if (err instanceof CancelledError) continue;
          if (err.isGatewayDown) p.log.info(err.message);
          else p.log.error(err.message);
          await waitForEnter();
          process.exitCode = 1;
          continue;
        }
      }

      const submenu = SUBMENUS[selected];
      if (!submenu) continue;

      const subSelected = await p.select({
        message: `${MENU_GROUPS[selected].label}`,
        options: submenu,
      });

      if (p.isCancel(subSelected)) {
        continue;
      }

      try {
        await routeCommand(client, subSelected, []);
        await waitForEnter();
      } catch (err) {
        if (err instanceof CancelledError) {
          continue;
        }
        if (err.isGatewayDown) {
          p.log.info(err.message);
        } else {
          p.log.error(err.message);
        }
        await waitForEnter();
        process.exitCode = 1;
      }
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
    if (err instanceof CancelledError) {
      return;
    }
    if (err.isGatewayDown) {
      console.log(err.message);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exitCode = 1;
  }
}

main();
