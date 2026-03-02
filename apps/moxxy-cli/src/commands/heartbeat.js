/**
 * Heartbeat commands: set/list/disable.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, p } from '../ui.js';

export async function runHeartbeat(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  // Interactive sub-menu when no valid action
  if (!['set', 'list', 'disable'].includes(action) && isInteractive()) {
    action = await p.select({
      message: 'Heartbeat action',
      options: [
        { value: 'set',     label: 'Set heartbeat',     hint: 'configure heartbeat rule' },
        { value: 'list',    label: 'List heartbeats',   hint: 'show heartbeat rules' },
        { value: 'disable', label: 'Disable heartbeat', hint: 'turn off heartbeat' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'set': {
      let agentId = flags.agent;

      // Interactive wizard when missing agent
      if (!agentId && isInteractive()) {
        agentId = await pickAgent(client, 'Select agent for heartbeat');

        const intervalInput = handleCancel(await p.text({
          message: 'Interval in minutes',
          placeholder: '5',
          initialValue: flags.interval || '5',
          validate: (val) => { if (!val || isNaN(parseInt(val, 10))) return 'Must be a number'; },
        }));
        const interval = parseInt(intervalInput, 10);

        const actionType = handleCancel(await p.select({
          message: 'Action type',
          options: [
            { value: 'notify_cli', label: 'Notify CLI', hint: 'send notification to CLI' },
            { value: 'webhook',    label: 'Webhook',    hint: 'call external webhook' },
            { value: 'restart',    label: 'Restart',    hint: 'restart the agent' },
          ],
        }));

        const body = {
          interval_minutes: interval,
          action_type: actionType,
        };

        if (actionType === 'webhook') {
          const payload = handleCancel(await p.text({
            message: 'Webhook URL or payload',
            placeholder: 'https://...',
          }));
          if (payload) body.action_payload = payload;
        }

        const result = await withSpinner('Setting heartbeat...', () =>
          client.request(`/v1/agents/${encodeURIComponent(agentId)}/heartbeats`, 'POST', body), 'Heartbeat configured.');

        showResult('Heartbeat Set', {
          Agent: agentId,
          Interval: `${interval} min`,
          Action: actionType,
        });

        return result;
      }

      if (!agentId) throw new Error('Required: --agent');
      const body = {
        interval_minutes: parseInt(flags.interval || '5', 10),
        action_type: flags.action_type || 'notify_cli',
      };
      if (flags.payload) body.action_payload = flags.payload;
      const result = await client.request(`/v1/agents/${encodeURIComponent(agentId)}/heartbeats`, 'POST', body);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    case 'list': {
      const agentId = flags.agent;
      if (!agentId && isInteractive()) {
        const id = await pickAgent(client, 'Select agent to list heartbeats');
        const result = await withSpinner('Fetching heartbeats...', () =>
          client.request(`/v1/agents/${encodeURIComponent(id)}/heartbeats`, 'GET'), 'Heartbeats loaded.');
        console.log(JSON.stringify(result, null, 2));
        return result;
      }
      if (!agentId) throw new Error('Required: --agent');
      const result = await client.request(`/v1/agents/${encodeURIComponent(agentId)}/heartbeats`, 'GET');
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    case 'disable': {
      console.error('Heartbeat disable not yet implemented.');
      process.exitCode = 1;
      break;
    }

    default:
      console.error('Usage: moxxy heartbeat <set|list|disable>');
      process.exitCode = 1;
  }
}
