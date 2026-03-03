/**
 * Skill commands: create/remove/list.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, pickSkill, p } from '../ui.js';

export async function runSkill(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  // Interactive sub-menu when no valid action
  if (!['create', 'remove', 'list'].includes(action) && isInteractive()) {
    action = await p.select({
      message: 'Skill action',
      options: [
        { value: 'create',  label: 'Create skill',  hint: 'install a skill on an agent' },
        { value: 'remove',  label: 'Remove skill',  hint: 'remove a skill from an agent' },
        { value: 'list',    label: 'List skills',   hint: 'list agent skills' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'create': {
      let agentId = flags.agent;

      // Interactive wizard when missing agent
      if (!agentId && isInteractive()) {
        agentId = await pickAgent(client, 'Select agent for skill');

        const content = flags.content || handleCancel(await p.text({
          message: 'Skill content (SKILL.md with YAML frontmatter)',
          placeholder: 'Paste skill content...',
          validate: (val) => { if (!val) return 'Content is required'; },
        }));

        const body = { content };
        const result = await withSpinner('Creating skill...', () =>
          client.request(`/v1/agents/${encodeURIComponent(agentId)}/skills/install`, 'POST', body), 'Skill created.');

        showResult('Skill Created', {
          Agent: agentId,
          Name: result.name,
          Version: result.version,
        });

        return result;
      }

      if (!agentId) throw new Error('Required: --agent');
      const body = {
        content: flags.content || '',
      };
      const result = await client.request(`/v1/agents/${encodeURIComponent(agentId)}/skills/install`, 'POST', body);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    case 'remove': {
      let agentId = flags.agent;
      let skillId = flags.skill;

      if ((!agentId || !skillId) && isInteractive()) {
        if (!agentId) {
          agentId = await pickAgent(client, 'Select agent');
        }
        if (!skillId) {
          skillId = await pickSkill(client, agentId, 'Select skill to remove');
        }

        const confirmed = await p.confirm({
          message: 'Remove this skill?',
          initialValue: false,
        });
        handleCancel(confirmed);
        if (!confirmed) {
          p.log.info('Cancelled.');
          return;
        }
      }

      if (!agentId || !skillId) throw new Error('Required: --agent, --skill');
      const result = await client.deleteSkill(agentId, skillId);
      if (isInteractive()) {
        p.log.success(`Skill ${skillId} removed.`);
      } else {
        console.log(`Skill ${skillId} removed.`);
      }
      return result;
    }

    case 'list': {
      let agentId = flags.agent;
      if (!agentId && isInteractive()) {
        agentId = await pickAgent(client, 'Select agent to list skills');
      }
      if (!agentId) throw new Error('Required: --agent');

      const skills = isInteractive()
        ? await withSpinner('Fetching skills...', () =>
            client.listSkills(agentId), 'Skills loaded.')
        : await client.listSkills(agentId);

      if (isInteractive()) {
        if (Array.isArray(skills) && skills.length > 0) {
          for (const s of skills) {
            p.log.info(`${s.name} v${s.version}  (${s.slug || s.name})`);
          }
        } else {
          p.log.warn('No skills found for this agent.');
        }
      } else {
        console.log(JSON.stringify(skills, null, 2));
      }
      return skills;
    }

    default: {
      const { showHelp } = await import('../help.js');
      showHelp('skill', p);
      break;
    }
  }
}
