/**
 * Agent commands: create/run/stop/status.
 */
import { parseFlags } from './auth.js';

export function parseAgentCommand(args) {
  const [action, ...rest] = args;
  const flags = parseFlags(rest);

  switch (action) {
    case 'create':
      return {
        action: 'create',
        provider_id: flags.provider,
        model_id: flags.model,
        workspace_root: flags.workspace,
        temperature: flags.temperature ? parseFloat(flags.temperature) : undefined,
        policy_profile: flags.policy,
        json: flags.json === true || flags.json === 'true',
      };

    case 'run':
      return {
        action: 'run',
        id: flags.id,
        task: flags.task,
        json: flags.json === true || flags.json === 'true',
      };

    case 'stop':
      return {
        action: 'stop',
        id: flags.id,
      };

    case 'status':
      return {
        action: 'status',
        id: flags.id,
        json: flags.json === true || flags.json === 'true',
      };

    default:
      return { action };
  }
}

export async function agentCreate(client, args) {
  const flags = parseFlags(args);
  if (!flags.provider || !flags.model || !flags.workspace) {
    throw new Error('Required: --provider, --model, --workspace');
  }
  const body = {
    provider_id: flags.provider,
    model_id: flags.model,
    workspace_root: flags.workspace,
  };
  if (flags.temperature) body.temperature = parseFloat(flags.temperature);
  if (flags.policy) body.policy_profile = flags.policy;

  const result = await client.request('/v1/agents', 'POST', body);
  if (flags.json === 'true' || flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Agent created: ${result.id}`);
  }
  return result;
}

export async function agentStatus(client, id, opts = {}) {
  if (!id) throw new Error('Required: agent ID');
  const result = await client.request(`/v1/agents/${encodeURIComponent(id)}`, 'GET');
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Agent: ${result.id}`);
    console.log(`  Status: ${result.status}`);
  }
  return result;
}

export async function runAgent(client, args) {
  const parsed = parseAgentCommand(args);

  switch (parsed.action) {
    case 'create':
      return agentCreate(client, args.slice(1));

    case 'run': {
      if (!parsed.id || !parsed.task) {
        throw new Error('Required: --id, --task');
      }
      const result = await client.request(`/v1/agents/${encodeURIComponent(parsed.id)}/runs`, 'POST', { task: parsed.task });
      if (parsed.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Run started for agent ${parsed.id}`);
      }
      return result;
    }

    case 'stop': {
      if (!parsed.id) throw new Error('Required: --id');
      await client.request(`/v1/agents/${encodeURIComponent(parsed.id)}/stop`, 'POST');
      console.log(`Agent ${parsed.id} stopped.`);
      break;
    }

    case 'status':
      return agentStatus(client, parsed.id, { json: parsed.json });

    default:
      console.error('Usage: moxxy agent <create|run|stop|status>');
      process.exitCode = 1;
  }
}
