/**
 * Vault commands: add/grant/revoke/list.
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

export async function runVault(client, args) {
  const [action, ...rest] = args;
  const flags = parseFlags(rest);

  switch (action) {
    case 'add': {
      const body = {
        key_name: flags.key || flags.name,
        backend_key: flags.backend,
      };
      if (flags.label) body.policy_label = flags.label;
      if (!body.key_name || !body.backend_key) {
        throw new Error('Required: --key, --backend');
      }
      const result = await client.request('/v1/vault/secrets', 'POST', body);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    case 'grant': {
      if (!flags.agent || !flags.secret) {
        throw new Error('Required: --agent, --secret');
      }
      const body = {
        agent_id: flags.agent,
        secret_ref_id: flags.secret,
      };
      const result = await client.request('/v1/vault/grants', 'POST', body);
      console.log(`Grant created for agent ${flags.agent}.`);
      return result;
    }

    case 'revoke':
    case 'list':
      console.error(`Vault ${action} not yet implemented.`);
      process.exitCode = 1;
      break;

    default:
      console.error('Usage: moxxy vault <add|grant|revoke|list>');
      process.exitCode = 1;
  }
}
