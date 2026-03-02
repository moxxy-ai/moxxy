/**
 * Heartbeat commands: set/list/disable.
 */

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

export async function runHeartbeat(client, args) {
  const [action, ...rest] = args;
  const flags = parseFlags(rest);

  switch (action) {
    case 'set': {
      const agentId = flags.agent;
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
