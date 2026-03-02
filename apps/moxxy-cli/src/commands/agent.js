/**
 * Agent commands: create/run/stop/status.
 */
import { parseFlags } from './auth.js';
import { getMoxxyHome } from './init.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, pickProvider, pickModel, p } from '../ui.js';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

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

  // Interactive sub-menu when no valid action
  if (!['create', 'run', 'stop', 'status'].includes(parsed.action) && isInteractive()) {
    const action = await p.select({
      message: 'Agent action',
      options: [
        { value: 'create', label: 'Create agent', hint: 'provision a new agent' },
        { value: 'run',    label: 'Start run',    hint: 'run a task on an agent' },
        { value: 'stop',   label: 'Stop agent',   hint: 'stop a running agent' },
        { value: 'status', label: 'Agent status',  hint: 'check agent status' },
      ],
    });
    handleCancel(action);
    parsed.action = action;
  }

  switch (parsed.action) {
    case 'create': {
      // Interactive wizard when missing required flags
      if ((!parsed.provider_id || !parsed.model_id) && isInteractive()) {
        p.intro('Create Agent');

        const providerId = parsed.provider_id || await pickProvider(client);
        const modelId = parsed.model_id || await pickModel(client, providerId);

        const defaultWorkspace = join(getMoxxyHome(), 'agents', 'new-agent', 'workspace');
        const workspace = await p.text({
          message: 'Workspace root',
          placeholder: defaultWorkspace,
          initialValue: parsed.workspace_root || defaultWorkspace,
        });
        handleCancel(workspace);

        const tempInput = await p.text({
          message: 'Temperature',
          placeholder: '0.7',
          initialValue: parsed.temperature !== undefined ? String(parsed.temperature) : '0.7',
        });
        handleCancel(tempInput);
        const temperature = tempInput ? parseFloat(tempInput) : 0.7;

        const body = {
          provider_id: providerId,
          model_id: modelId,
          workspace_root: workspace,
          temperature,
        };

        const result = await withSpinner('Creating agent...', () =>
          client.request('/v1/agents', 'POST', body), 'Agent created.');

        // Create agent workspace directory
        if (result.id) {
          const agentDir = join(getMoxxyHome(), 'agents', result.id);
          try {
            mkdirSync(join(agentDir, 'workspace'), { recursive: true });
            mkdirSync(join(agentDir, 'memory'), { recursive: true });
          } catch { /* may already exist */ }
        }

        showResult('Agent Created', {
          ID: result.id,
          Provider: providerId,
          Model: modelId,
          Workspace: workspace,
          Status: result.status,
        });

        const startRun = await p.confirm({
          message: 'Start a run?',
          initialValue: false,
        });
        handleCancel(startRun);

        if (startRun) {
          const task = await p.text({
            message: 'Task description',
            placeholder: 'Describe the task...',
          });
          handleCancel(task);

          await withSpinner('Starting run...', () =>
            client.request(`/v1/agents/${encodeURIComponent(result.id)}/runs`, 'POST', { task }), 'Run started.');
        }

        return result;
      }

      return agentCreate(client, args.slice(1));
    }

    case 'run': {
      // Interactive wizard when missing id or task
      if ((!parsed.id || !parsed.task) && isInteractive()) {
        const agentId = parsed.id || await pickAgent(client, 'Select agent to run');

        const task = parsed.task || handleCancel(await p.text({
          message: 'Task description',
          placeholder: 'Describe the task...',
          validate: (val) => { if (!val) return 'Task is required'; },
        }));

        const result = await withSpinner('Starting run...', () =>
          client.request(`/v1/agents/${encodeURIComponent(agentId)}/runs`, 'POST', { task }), 'Run started.');

        showResult('Run Started', {
          Agent: agentId,
          'Run ID': result.run_id || result.id,
        });

        const tailEvents = await p.confirm({
          message: 'Tail events?',
          initialValue: false,
        });
        handleCancel(tailEvents);

        if (tailEvents) {
          const { runEvents } = await import('./events.js');
          await runEvents(client, ['tail', '--agent', agentId]);
        }

        return result;
      }

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
      let id = parsed.id;

      if (!id && isInteractive()) {
        id = await pickAgent(client, 'Select agent to stop');
      }

      if (!id) throw new Error('Required: --id');

      if (isInteractive()) {
        await withSpinner('Stopping agent...', () =>
          client.request(`/v1/agents/${encodeURIComponent(id)}/stop`, 'POST'), 'Agent stopped.');
      } else {
        await client.request(`/v1/agents/${encodeURIComponent(id)}/stop`, 'POST');
        console.log(`Agent ${id} stopped.`);
      }
      break;
    }

    case 'status': {
      let id = parsed.id;

      if (!id && isInteractive()) {
        id = await pickAgent(client, 'Select agent to check');
      }

      if (!id) throw new Error('Required: --id');

      if (isInteractive()) {
        const result = await withSpinner('Fetching status...', () =>
          client.request(`/v1/agents/${encodeURIComponent(id)}`, 'GET'), 'Status loaded.');

        showResult('Agent Status', {
          ID: result.id,
          Status: result.status,
          Provider: result.provider_id,
          Model: result.model_id,
        });
        return result;
      }

      return agentStatus(client, id, { json: parsed.json });
    }

    default:
      console.error('Usage: moxxy agent <create|run|stop|status>');
      process.exitCode = 1;
  }
}
