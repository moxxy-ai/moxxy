#!/usr/bin/env node

import { createApiClient } from './api-client.js';
import { isInteractive, handleCancel, p } from './ui.js';
import { runInit } from './commands/init.js';
import { runAuth } from './commands/auth.js';
import { runAgent } from './commands/agent.js';
import { runProvider } from './commands/provider.js';
import { runSkill } from './commands/skill.js';
import { runHeartbeat } from './commands/heartbeat.js';
import { runVault } from './commands/vault.js';
import { runEvents } from './commands/events.js';

const HELP = `
moxxy - Agentic Framework CLI

Usage:
  moxxy                                               Interactive menu
  moxxy init                                          First-time setup wizard
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
  moxxy events tail [--agent <id>] [--run <id>] [--json]

Environment:
  MOXXY_API_URL   API base URL (default: http://localhost:3000)
  MOXXY_TOKEN     API token for authentication
`.trim();

async function routeCommand(client, command, rest) {
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
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

async function main() {
  const [,, command, ...rest] = process.argv;

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  const baseUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  const token = process.env.MOXXY_TOKEN || '';
  const client = createApiClient(baseUrl, token);

  if (!command && isInteractive()) {
    p.intro('moxxy');

    const selected = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'init',      label: 'Init',      hint: 'first-time setup' },
        { value: 'auth',      label: 'Auth',      hint: 'manage API tokens' },
        { value: 'agent',     label: 'Agent',     hint: 'create & manage agents' },
        { value: 'provider',  label: 'Provider',  hint: 'list providers' },
        { value: 'skill',     label: 'Skill',     hint: 'import & manage skills' },
        { value: 'heartbeat', label: 'Heartbeat', hint: 'schedule heartbeat rules' },
        { value: 'vault',     label: 'Vault',     hint: 'manage secrets' },
        { value: 'events',    label: 'Events',    hint: 'stream live events' },
      ],
    });
    handleCancel(selected);

    try {
      await routeCommand(client, selected, []);
    } catch (err) {
      p.log.error(err.message);
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
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
