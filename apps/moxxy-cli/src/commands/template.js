/**
 * Template commands: list/get/create/update/remove/assign.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, p } from '../ui.js';

async function pickTemplate(client, message = 'Select template') {
  const templates = await client.listTemplates();
  if (!templates || templates.length === 0) {
    throw new Error('No templates found. Create one first.');
  }
  const options = templates.map(t => ({
    value: t.slug,
    label: t.name,
    hint: t.description,
  }));
  const selected = await p.select({ message, options });
  handleCancel(selected);
  return selected;
}

export async function runTemplate(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  // Interactive sub-menu when no valid action
  if (!['list', 'get', 'create', 'update', 'remove', 'assign'].includes(action) && isInteractive()) {
    action = await p.select({
      message: 'Template action',
      options: [
        { value: 'list',   label: 'List templates',   hint: 'list all templates' },
        { value: 'get',    label: 'Get template',     hint: 'view template details' },
        { value: 'create', label: 'Create template',  hint: 'create a new template' },
        { value: 'update', label: 'Update template',  hint: 'update an existing template' },
        { value: 'remove', label: 'Remove template',  hint: 'delete a template' },
        { value: 'assign', label: 'Assign template',  hint: 'assign a template to an agent' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'list': {
      const templates = isInteractive()
        ? await withSpinner('Fetching templates...', () =>
            client.listTemplates(), 'Templates loaded.')
        : await client.listTemplates();

      if (isInteractive()) {
        if (Array.isArray(templates) && templates.length > 0) {
          for (const t of templates) {
            const tags = t.tags && t.tags.length > 0 ? ` [${t.tags.join(', ')}]` : '';
            p.log.info(`${t.name} v${t.version}  (${t.slug})${tags}`);
          }
        } else {
          p.log.warn('No templates found.');
        }
      } else {
        console.log(JSON.stringify(templates, null, 2));
      }
      return templates;
    }

    case 'get': {
      let slug = flags.slug || rest[0];
      if (!slug && isInteractive()) {
        slug = await pickTemplate(client, 'Select template to view');
      }
      if (!slug) throw new Error('Required: --slug or positional argument');

      const template = isInteractive()
        ? await withSpinner('Fetching template...', () =>
            client.getTemplate(slug), 'Template loaded.')
        : await client.getTemplate(slug);

      if (isInteractive()) {
        showResult('Template', {
          Name: template.name,
          Slug: template.slug,
          Version: template.version,
          Description: template.description,
          Tags: (template.tags || []).join(', ') || '(none)',
        });
        if (template.body) {
          p.log.info(`\nContent:\n${template.body}`);
        }
      } else {
        console.log(JSON.stringify(template, null, 2));
      }
      return template;
    }

    case 'create': {
      let content = flags.content;

      if (!content && isInteractive()) {
        content = handleCancel(await p.text({
          message: 'Template content (TEMPLATE.md with YAML frontmatter)',
          placeholder: 'Paste template content...',
          validate: (val) => { if (!val) return 'Content is required'; },
        }));
      }
      if (!content) throw new Error('Required: --content');

      const result = isInteractive()
        ? await withSpinner('Creating template...', () =>
            client.createTemplate(content), 'Template created.')
        : await client.createTemplate(content);

      if (isInteractive()) {
        showResult('Template Created', {
          Name: result.name,
          Slug: result.slug,
          Version: result.version,
        });
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      return result;
    }

    case 'update': {
      let slug = flags.slug;
      let content = flags.content;

      if ((!slug || !content) && isInteractive()) {
        if (!slug) {
          slug = await pickTemplate(client, 'Select template to update');
        }
        if (!content) {
          content = handleCancel(await p.text({
            message: 'New template content',
            placeholder: 'Paste updated content...',
            validate: (val) => { if (!val) return 'Content is required'; },
          }));
        }
      }
      if (!slug || !content) throw new Error('Required: --slug, --content');

      const result = isInteractive()
        ? await withSpinner('Updating template...', () =>
            client.updateTemplate(slug, content), 'Template updated.')
        : await client.updateTemplate(slug, content);

      if (isInteractive()) {
        showResult('Template Updated', {
          Slug: slug,
          Name: result.name,
          Version: result.version,
        });
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      return result;
    }

    case 'remove': {
      let slug = flags.slug || rest[0];

      if (!slug && isInteractive()) {
        slug = await pickTemplate(client, 'Select template to remove');
        const confirmed = await p.confirm({
          message: `Remove template "${slug}"?`,
          initialValue: false,
        });
        handleCancel(confirmed);
        if (!confirmed) {
          p.log.info('Cancelled.');
          return;
        }
      }
      if (!slug) throw new Error('Required: --slug or positional argument');

      await (isInteractive()
        ? withSpinner('Removing template...', () =>
            client.deleteTemplate(slug), 'Template removed.')
        : client.deleteTemplate(slug));

      if (isInteractive()) {
        p.log.success(`Template ${slug} removed.`);
      } else {
        console.log(`Template ${slug} removed.`);
      }
      return;
    }

    case 'assign': {
      let agentId = flags.agent;
      let slug = flags.slug || flags.template;

      if ((!agentId || slug === undefined) && isInteractive()) {
        if (!agentId) {
          agentId = await pickAgent(client, 'Select agent');
        }

        const clearOrAssign = await p.select({
          message: 'Action',
          options: [
            { value: 'assign', label: 'Assign template', hint: 'assign a template to this agent' },
            { value: 'clear',  label: 'Clear template',  hint: 'remove template assignment' },
          ],
        });
        handleCancel(clearOrAssign);

        if (clearOrAssign === 'clear') {
          slug = null;
        } else {
          slug = await pickTemplate(client, 'Select template to assign');
        }
      }

      if (!agentId) throw new Error('Required: --agent');

      const result = isInteractive()
        ? await withSpinner('Updating agent template...', () =>
            client.setAgentTemplate(agentId, slug), 'Agent template updated.')
        : await client.setAgentTemplate(agentId, slug);

      if (isInteractive()) {
        if (slug) {
          p.log.success(`Template "${slug}" assigned to agent "${agentId}".`);
        } else {
          p.log.success(`Template cleared from agent "${agentId}".`);
        }
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      return result;
    }

    default: {
      const { showHelp } = await import('../help.js');
      showHelp('template', p);
      break;
    }
  }
}
