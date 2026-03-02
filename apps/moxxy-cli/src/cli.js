#!/usr/bin/env node

/**
 * Moxxy CLI entry point.
 * Routes top-level commands to subcommand handlers.
 */
import { createApiClient } from './api-client.js';
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
  moxxy auth token create [--scopes <s>] [--ttl <n>] [--json]
  moxxy auth token list [--json]
  moxxy auth token revoke <id>
  moxxy agent create --provider <p> --model <m> --workspace <w> [--json]
  moxxy agent run --id <id> --task "task" [--json]
  moxxy agent stop --id <id>
  moxxy agent status --id <id> [--json]
  moxxy provider install|list|verify
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

async function main() {
  const [,, command, ...rest] = process.argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  const baseUrl = process.env.MOXXY_API_URL || 'http://localhost:3000';
  const token = process.env.MOXXY_TOKEN || '';
  const client = createApiClient(baseUrl, token);

  try {
    switch (command) {
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
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
