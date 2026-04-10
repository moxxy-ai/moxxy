/**
 * Webhook commands: list/add/update/remove.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, p } from '../ui.js';

function parseBool(val) {
  if (val === undefined || val === null) return undefined;
  const s = String(val).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return undefined;
}

export async function runWebhooks(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  if (!['list', 'add', 'update', 'remove'].includes(action) && isInteractive()) {
    action = await p.select({
      message: 'Webhook action',
      options: [
        { value: 'list',   label: 'List webhooks',  hint: 'show webhooks for an agent' },
        { value: 'add',    label: 'Add webhook',    hint: 'register a new inbound webhook' },
        { value: 'update', label: 'Update webhook', hint: 'change label/body/filter/enabled' },
        { value: 'remove', label: 'Remove webhook', hint: 'delete an inbound webhook' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'list': {
      let agentName = flags.agent;
      if (!agentName && isInteractive()) {
        agentName = await pickAgent(client, 'Select agent');
      }
      if (!agentName) throw new Error('Required: --agent');

      const webhooks = isInteractive()
        ? await withSpinner('Fetching webhooks...', () =>
            client.listWebhooks(agentName), 'Webhooks loaded.')
        : await client.listWebhooks(agentName);

      if (isInteractive()) {
        if (Array.isArray(webhooks) && webhooks.length > 0) {
          for (const w of webhooks) {
            const state = w.enabled ? 'enabled' : 'disabled';
            const filter = w.event_filter ? ` filter=${w.event_filter}` : '';
            p.log.info(`  ${w.slug}  [${state}]${filter}  ${w.url}`);
          }
        } else {
          p.log.warn('No webhooks configured for this agent.');
        }
      } else {
        console.log(JSON.stringify(webhooks, null, 2));
      }
      return webhooks;
    }

    case 'add': {
      let agentName = flags.agent;
      let label = flags.label;

      if ((!agentName || !label) && isInteractive()) {
        if (!agentName) {
          agentName = await pickAgent(client, 'Select agent for webhook');
        }

        if (!label) {
          label = handleCancel(await p.text({
            message: 'Webhook label',
            placeholder: 'GitHub Push Events',
            validate: (val) => { if (!val) return 'Label is required'; },
          }));
        }

        const body = { label };

        const secret = flags.secret || handleCancel(await p.text({
          message: 'HMAC secret (optional, leave empty for token-only)',
          placeholder: '',
        }));
        if (secret) body.secret = secret;

        const eventFilter = flags.event_filter || handleCancel(await p.text({
          message: 'Event filter (optional, comma-separated)',
          placeholder: 'push,pull_request',
        }));
        if (eventFilter) body.event_filter = eventFilter;

        const taskBody = flags.body || handleCancel(await p.text({
          message: 'Task instructions (optional markdown with {{placeholders}})',
          placeholder: 'Parse commits from {{body.commits}}...',
        }));
        if (taskBody) body.body = taskBody;

        const result = await withSpinner('Creating webhook...', () =>
          client.createWebhook(agentName, body), 'Webhook created.');

        showResult('Webhook Created', {
          Agent: agentName,
          Label: label,
          Slug: result.slug,
          URL: result.url,
          Token: result.token,
        });

        return result;
      }

      if (!agentName || !label) {
        throw new Error('Required: --agent, --label');
      }

      const body = { label };
      if (flags.secret) body.secret = flags.secret;
      if (flags.event_filter) body.event_filter = flags.event_filter;
      if (flags.body) body.body = flags.body;

      const result = await client.createWebhook(agentName, body);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    case 'update': {
      let agentName = flags.agent;
      let slug = flags.slug;

      if ((!agentName || !slug) && isInteractive()) {
        if (!agentName) {
          agentName = await pickAgent(client, 'Select agent');
        }

        if (!slug) {
          const webhooks = await withSpinner('Fetching webhooks...', () =>
            client.listWebhooks(agentName), 'Webhooks loaded.');
          if (!Array.isArray(webhooks) || webhooks.length === 0) {
            p.log.warn('No webhooks to update.');
            return;
          }
          slug = handleCancel(await p.select({
            message: 'Select webhook to update',
            options: webhooks.map(w => ({
              value: w.slug,
              label: w.label,
              hint: w.enabled ? 'enabled' : 'disabled',
            })),
          }));
        }
      }

      if (!agentName || !slug) throw new Error('Required: --agent, --slug');

      const patch = {};
      if (flags.label !== undefined) patch.label = flags.label;
      if (flags.event_filter !== undefined) patch.event_filter = flags.event_filter;
      if (flags.body !== undefined) patch.body = flags.body;
      const enabled = parseBool(flags.enabled);
      if (enabled !== undefined) patch.enabled = enabled;

      if (Object.keys(patch).length === 0) {
        throw new Error('Nothing to update. Pass at least one of: --label, --event_filter, --body, --enabled');
      }

      const result = isInteractive()
        ? await withSpinner('Updating webhook...', () =>
            client.updateWebhook(agentName, slug, patch), 'Webhook updated.')
        : await client.updateWebhook(agentName, slug, patch);

      if (isInteractive()) {
        showResult('Webhook Updated', {
          Agent: agentName,
          Slug: result.slug,
          Label: result.label,
          Enabled: String(result.enabled),
        });
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      return result;
    }

    case 'remove': {
      let agentName = flags.agent;
      let slug = flags.slug;

      if ((!agentName || !slug) && isInteractive()) {
        if (!agentName) {
          agentName = await pickAgent(client, 'Select agent');
        }

        if (!slug) {
          const webhooks = await withSpinner('Fetching webhooks...', () =>
            client.listWebhooks(agentName), 'Webhooks loaded.');
          if (!Array.isArray(webhooks) || webhooks.length === 0) {
            p.log.warn('No webhooks to remove.');
            return;
          }
          slug = handleCancel(await p.select({
            message: 'Select webhook to remove',
            options: webhooks.map(w => ({
              value: w.slug,
              label: w.label,
              hint: w.enabled ? 'enabled' : 'disabled',
            })),
          }));
        }

        const confirmed = await p.confirm({
          message: `Remove webhook "${slug}"?`,
          initialValue: false,
        });
        handleCancel(confirmed);
        if (!confirmed) {
          p.log.info('Cancelled.');
          return;
        }

        await withSpinner('Removing webhook...', () =>
          client.deleteWebhook(agentName, slug), 'Webhook removed.');
        return;
      }

      if (!agentName || !slug) throw new Error('Required: --agent, --slug');

      await client.deleteWebhook(agentName, slug);
      console.log(`Webhook ${slug} removed.`);
      break;
    }

    default: {
      const { showHelp } = await import('../help.js');
      showHelp('webhooks', p);
      break;
    }
  }
}
