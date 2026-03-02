/**
 * Vault commands: add/grant/revoke/list.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, p } from '../ui.js';

export async function runVault(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  // Interactive sub-menu when no valid action
  if (!['add', 'grant', 'revoke', 'list'].includes(action) && isInteractive()) {
    action = await p.select({
      message: 'Vault action',
      options: [
        { value: 'add',    label: 'Add secret',    hint: 'register a new secret' },
        { value: 'grant',  label: 'Grant access',  hint: 'grant agent access to a secret' },
        { value: 'revoke', label: 'Revoke access', hint: 'revoke agent secret access' },
        { value: 'list',   label: 'List secrets',  hint: 'show all secrets' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'add': {
      // Interactive wizard when missing required fields
      if ((!flags.key && !flags.name) && isInteractive()) {
        const keyName = handleCancel(await p.text({
          message: 'Secret key name',
          placeholder: 'OPENAI_API_KEY',
          validate: (val) => { if (!val) return 'Key name is required'; },
        }));

        const backendKey = handleCancel(await p.text({
          message: 'Backend key reference',
          placeholder: 'env:OPENAI_API_KEY',
          validate: (val) => { if (!val) return 'Backend key is required'; },
        }));

        const policyLabel = handleCancel(await p.text({
          message: 'Policy label',
          placeholder: 'optional',
        }));

        const body = {
          key_name: keyName,
          backend_key: backendKey,
        };
        if (policyLabel) body.policy_label = policyLabel;

        const result = await withSpinner('Adding secret...', () =>
          client.request('/v1/vault/secrets', 'POST', body), 'Secret added.');

        showResult('Secret Added', {
          ID: result.id || result.secret_ref_id,
          Key: keyName,
          Backend: backendKey,
        });

        const grantNow = await p.confirm({
          message: 'Grant to an agent?',
          initialValue: false,
        });
        handleCancel(grantNow);

        if (grantNow) {
          const agentId = await pickAgent(client, 'Select agent to grant');
          const secretId = result.id || result.secret_ref_id;
          if (secretId) {
            await withSpinner('Granting access...', () =>
              client.request('/v1/vault/grants', 'POST', {
                agent_id: agentId,
                secret_ref_id: secretId,
              }), 'Access granted.');
          } else {
            p.log.warn('Could not determine secret ID for grant.');
          }
        }

        return result;
      }

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
