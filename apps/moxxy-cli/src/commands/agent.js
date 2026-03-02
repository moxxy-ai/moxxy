/**
 * Agent commands: create, run, stop, status.
 */
import { parseFlags } from './auth.js';

/**
 * Create an agent.
 */
export async function agentCreate(client, args) {
  const flags = parseFlags(args);
  const providerId = flags.provider || flags.provider_id;
  const modelId = flags.model || flags.model_id;
  const workspaceRoot = flags.workspace || flags.workspace_root;

  if (!providerId || !modelId || !workspaceRoot) {
    throw new Error('Required: --provider, --model, --workspace');
  }

  const opts = {};
  if (flags.temperature) opts.temperature = parseFloat(flags.temperature);
  if (flags.max_depth) opts.max_subagent_depth = parseInt(flags.max_depth, 10);
  if (flags.max_total) opts.max_subagents_total = parseInt(flags.max_total, 10);
  if (flags.policy) opts.policy_profile = flags.policy;

  const result = await client.createAgent(providerId, modelId, workspaceRoot, opts);

  if (flags.json === 'true') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Agent created: ${result.id}`);
  }
  return result;
}

/**
 * Start an agent run.
 */
export async function agentRun(client, args) {
  const flags = parseFlags(args);
  const agentId = args.find(a => !a.startsWith('--'));
  const task = flags.task;

  if (!agentId || !task) {
    throw new Error('Usage: moxxy agent run <agent_id> --task "your task"');
  }

  const result = await client.startRun(agentId, task);

  if (flags.json === 'true') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Run started for agent ${agentId}`);
    if (result.run_id) console.log(`Run ID: ${result.run_id}`);
  }
  return result;
}

/**
 * Stop an agent.
 */
export async function agentStop(client, args) {
  const agentId = args.find(a => !a.startsWith('--'));
  if (!agentId) {
    throw new Error('Usage: moxxy agent stop <agent_id>');
  }
  await client.stopAgent(agentId);
  console.log(`Agent ${agentId} stopped.`);
}

/**
 * Get agent status.
 */
export async function agentStatus(client, args) {
  const flags = parseFlags(args);
  const agentId = args.find(a => !a.startsWith('--'));
  if (!agentId) {
    throw new Error('Usage: moxxy agent status <agent_id>');
  }

  const result = await client.getAgent(agentId);

  if (flags.json === 'true') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Agent: ${result.id}`);
    console.log(`  Provider: ${result.provider_id}`);
    console.log(`  Model: ${result.model_id}`);
    console.log(`  Status: ${result.status}`);
    console.log(`  Workspace: ${result.workspace_root}`);
  }
  return result;
}

/**
 * Route agent subcommands.
 */
export async function agentCommand(client, args) {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'create':
      return agentCreate(client, rest);
    case 'run':
      return agentRun(client, rest);
    case 'stop':
      return agentStop(client, rest);
    case 'status':
      return agentStatus(client, rest);
    default:
      console.error('Usage: moxxy agent <create|run|stop|status>');
      process.exitCode = 1;
  }
}
