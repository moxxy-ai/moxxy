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

    case 'list': {
      if (isInteractive()) {
        const secrets = await withSpinner('Fetching secrets...', () =>
          client.listSecrets(), 'Secrets loaded.');
        const grants = await withSpinner('Fetching grants...', () =>
          client.listGrants(), 'Grants loaded.');

        if (Array.isArray(secrets) && secrets.length > 0) {
          p.log.info('\u2500\u2500 Secrets \u2500\u2500');
          for (const s of secrets) {
            p.log.info(`  ${s.key_name}  (${s.id.slice(0, 12)})  backend=${s.backend_key}`);
          }
        } else {
          p.log.warn('No secrets found.');
        }

        if (Array.isArray(grants) && grants.length > 0) {
          p.log.info('\u2500\u2500 Grants \u2500\u2500');
          for (const g of grants) {
            const status = g.revoked_at ? 'revoked' : 'active';
            p.log.info(`  agent=${g.agent_id.slice(0, 12)} secret=${g.secret_ref_id.slice(0, 12)}  [${status}]`);
          }
        } else {
          p.log.info('No grants found.');
        }
      } else {
        const secrets = await client.listSecrets();
        const grants = await client.listGrants();
        console.log(JSON.stringify({ secrets, grants }, null, 2));
      }
      break;
    }

    case 'revoke': {
      let grantId = flags.id || flags.grant;

      if (!grantId && isInteractive()) {
        const grants = await withSpinner('Fetching grants...', () =>
          client.listGrants(), 'Grants loaded.');

        const active = (grants || []).filter(g => !g.revoked_at);
        if (active.length === 0) {
          p.log.warn('No active grants to revoke.');
          return;
        }

        grantId = handleCancel(await p.select({
          message: 'Select grant to revoke',
          options: active.map(g => ({
            value: g.id,
            label: `agent=${g.agent_id.slice(0, 12)} secret=${g.secret_ref_id.slice(0, 12)}`,
            hint: g.id.slice(0, 12),
          })),
        }));
      }

      if (!grantId) throw new Error('Required: --id');

      if (isInteractive()) {
        await withSpinner('Revoking grant...', () =>
          client.revokeGrant(grantId), 'Grant revoked.');
      } else {
        await client.revokeGrant(grantId);
        console.log(`Grant ${grantId} revoked.`);
      }
      break;
    }

    default: {
      const { showHelp } = await import('../help.js');
      showHelp('vault', p);
      break;
    }
  }
}
