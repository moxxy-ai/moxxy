#!/usr/bin/env node

/**
 * Moxxy CLI - main entry point.
 * Routes commands to appropriate subcommand handlers.
 */
import { createClient } from './api-client.js';
import { authCommand } from './commands/auth.js';
import { agentCommand } from './commands/agent.js';
import { eventsCommand } from './commands/events.js';

const HELP = `
moxxy - Agentic Framework CLI

Usage:
  moxxy auth token create [--scopes <s>] [--ttl <n>] [--description <d>] [--json]
  moxxy auth token list [--json]
  moxxy auth token revoke <id>
  moxxy agent create --provider <p> --model <m> --workspace <w> [--json]
  moxxy agent run <agent_id> --task "task" [--json]
  moxxy agent stop <agent_id>
  moxxy agent status <agent_id> [--json]
  moxxy events tail [--agent <id>] [--run <id>] [--json]

Environment:
  MOXXY_API_URL   API base URL (default: http://localhost:3000)
  MOXXY_TOKEN     API token for authentication
`.trim();

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP);
    return;
  }

  const client = createClient();
  const command = args[0];
  const rest = args.slice(1);

  try {
    switch (command) {
      case 'auth':
        await authCommand(client, rest);
        break;
      case 'agent':
        await agentCommand(client, rest);
        break;
      case 'events':
        await eventsCommand(client, rest);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
