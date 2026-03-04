/**
 * Agent commands: create/run/stop/status.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, pickProvider, pickModel, p } from '../ui.js';

function firstModel(flag) {
  if (Array.isArray(flag)) return flag[0];
  return flag;
}

export function parseAgentCommand(args) {
  const [action, ...rest] = args;
  const flags = parseFlags(rest);

  switch (action) {
    case 'create':
      return {
        action: 'create',
        provider_id: flags.provider,
        model_id: firstModel(flags.model),
        name: flags.name,
        persona: flags.persona,
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

    case 'update':
      return {
        action: 'update',
        id: flags.id,
        provider_id: flags.provider,
        model_id: firstModel(flags.model),
        temperature: flags.temperature ? parseFloat(flags.temperature) : undefined,
        json: flags.json === true || flags.json === 'true',
      };

    case 'delete':
      return {
        action: 'delete',
        id: flags.id,
      };

    default:
      return { action };
  }
}

export async function agentCreate(client, args) {
  const flags = parseFlags(args);
  if (!flags.provider || !flags.model || !flags.name) {
    throw new Error('Required: --provider, --model, --name');
  }
  const body = {
    provider_id: flags.provider,
    model_id: firstModel(flags.model),
    name: flags.name,
  };
  if (flags.temperature) body.temperature = parseFloat(flags.temperature);
  if (flags.policy) body.policy_profile = flags.policy;
  if (flags.persona) body.persona = flags.persona;

  const result = await client.request('/v1/agents', 'POST', body);
  if (flags.json === 'true' || flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Agent created: ${result.name}`);
  }
  return result;
}

export async function agentUpdate(client, args) {
  const flags = parseFlags(args);
  if (!flags.id) {
    throw new Error('Required: --id');
  }
  const body = {};
  if (flags.provider) body.provider_id = flags.provider;
  if (flags.model) body.model_id = firstModel(flags.model);
  if (flags.temperature) body.temperature = parseFloat(flags.temperature);

  if (Object.keys(body).length === 0) {
    throw new Error('Nothing to update. Provide --provider, --model, or --temperature');
  }

  const result = await client.request(`/v1/agents/${encodeURIComponent(flags.id)}`, 'PATCH', body);
  if (flags.json === 'true' || flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Agent ${flags.id} updated.`);
  }
  return result;
}

export async function agentStatus(client, id, opts = {}) {
  if (!id) throw new Error('Required: agent ID');
  const result = await client.request(`/v1/agents/${encodeURIComponent(id)}`, 'GET');
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Agent: ${result.name}`);
    console.log(`  Status: ${result.status}`);
  }
  return result;
}

export async function runAgent(client, args) {
  const parsed = parseAgentCommand(args);

  // Interactive sub-menu when no valid action
  if (!['create', 'run', 'stop', 'status', 'update', 'delete'].includes(parsed.action) && isInteractive()) {
    const action = await p.select({
      message: 'Agent action',
      options: [
        { value: 'create', label: 'Create agent', hint: 'provision a new agent' },
        { value: 'update', label: 'Update agent', hint: 'change provider, model, or temperature' },
        { value: 'run',    label: 'Start run',    hint: 'run a task on an agent' },
        { value: 'stop',   label: 'Stop agent',   hint: 'stop a running agent' },
        { value: 'status', label: 'Agent status',  hint: 'check agent status' },
        { value: 'delete', label: 'Delete agent', hint: 'permanently remove an agent' },
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

        const nameInput = await p.text({
          message: 'Agent name',
          placeholder: 'my-agent',
          initialValue: parsed.name || '',
          validate: (val) => {
            if (!val) return 'Name is required';
            if (val.length > 64) return 'Name must be 64 chars or fewer';
            if (!/^[a-z0-9][a-z0-9-]*$/.test(val)) return 'Lowercase alphanumeric + hyphens, starting with alphanumeric';
          },
        });
        handleCancel(nameInput);

        const providerId = parsed.provider_id || await pickProvider(client);
        const modelId = parsed.model_id || await pickModel(client, providerId);

        const personaInput = await p.text({
          message: 'Agent persona (optional)',
          placeholder: 'You are a helpful coding assistant...',
          initialValue: parsed.persona || '',
        });
        handleCancel(personaInput);

        const tempInput = await p.text({
          message: 'Temperature',
          placeholder: '0.7',
          initialValue: parsed.temperature !== undefined ? String(parsed.temperature) : '0.7',
        });
        handleCancel(tempInput);
        const temperature = tempInput ? parseFloat(tempInput) : 0.7;

        const body = {
          name: nameInput,
          provider_id: providerId,
          model_id: modelId,
          temperature,
        };
        if (personaInput) body.persona = personaInput;

        const result = await withSpinner('Creating agent...', () =>
          client.request('/v1/agents', 'POST', body), 'Agent created.');

        showResult('Agent Created', {
          Name: result.name,
          Provider: providerId,
          Model: modelId,
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
            client.request(`/v1/agents/${encodeURIComponent(result.name)}/runs`, 'POST', { task }), 'Run started.');
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
          Name: result.name,
          Status: result.status,
          Provider: result.provider_id,
          Model: result.model_id,
        });
        return result;
      }

      return agentStatus(client, id, { json: parsed.json });
    }

    case 'update': {
      // Interactive wizard when missing id
      if (!parsed.id && isInteractive()) {
        p.intro('Update Agent');

        const agentId = await pickAgent(client, 'Select agent to update');
        const current = await client.request(`/v1/agents/${encodeURIComponent(agentId)}`, 'GET');

        p.log.info(`Current: ${current.provider_id}/${current.model_id} (temp=${current.temperature ?? 0.7})`);

        const providerId = await pickProvider(client);
        const modelId = await pickModel(client, providerId);

        const tempInput = await p.text({
          message: 'Temperature',
          placeholder: '0.7',
          initialValue: String(current.temperature ?? 0.7),
        });
        handleCancel(tempInput);
        const temperature = tempInput ? parseFloat(tempInput) : 0.7;

        const body = { provider_id: providerId, model_id: modelId, temperature };
        const result = await withSpinner('Updating agent...', () =>
          client.request(`/v1/agents/${encodeURIComponent(agentId)}`, 'PATCH', body), 'Agent updated.');

        showResult('Agent Updated', {
          ID: agentId,
          Provider: providerId,
          Model: modelId,
          Temperature: temperature,
          Status: result.status,
        });

        return result;
      }

      return agentUpdate(client, args.slice(1));
    }

    case 'delete': {
      let id = parsed.id;

      if (!id && isInteractive()) {
        id = await pickAgent(client, 'Select agent to delete');

        const confirmed = await p.confirm({
          message: 'Permanently delete this agent and all its data?',
          initialValue: false,
        });
        handleCancel(confirmed);
        if (!confirmed) {
          p.log.info('Cancelled.');
          return;
        }
      }

      if (!id) throw new Error('Required: --id');

      await client.deleteAgent(id);
      if (isInteractive()) {
        p.log.success(`Agent ${id} deleted.`);
      } else {
        console.log(`Agent ${id} deleted.`);
      }
      break;
    }

    default: {
      const { showHelp } = await import('../help.js');
      showHelp('agent', p);
      break;
    }
  }
}
