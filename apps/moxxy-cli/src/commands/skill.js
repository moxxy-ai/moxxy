/**
 * Skill commands: import/approve/remove/list.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, pickAgent, pickSkill, p } from '../ui.js';

export async function runSkill(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  // Interactive sub-menu when no valid action
  if (!['import', 'approve', 'remove', 'list'].includes(action) && isInteractive()) {
    action = await p.select({
      message: 'Skill action',
      options: [
        { value: 'import',  label: 'Import skill',  hint: 'install a skill on an agent' },
        { value: 'approve', label: 'Approve skill', hint: 'approve a pending skill' },
        { value: 'remove',  label: 'Remove skill',  hint: 'remove a skill from an agent' },
        { value: 'list',    label: 'List skills',   hint: 'list agent skills' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'import': {
      let agentId = flags.agent;

      // Interactive wizard when missing agent
      if (!agentId && isInteractive()) {
        agentId = await pickAgent(client, 'Select agent for skill');

        const name = flags.name || handleCancel(await p.text({
          message: 'Skill name',
          placeholder: 'my-skill',
          validate: (val) => { if (!val) return 'Name is required'; },
        }));

        const version = flags.version || handleCancel(await p.text({
          message: 'Skill version',
          placeholder: '0.1.0',
          initialValue: '0.1.0',
        }));

        const content = flags.content || handleCancel(await p.text({
          message: 'Skill content',
          placeholder: 'Paste skill content...',
          validate: (val) => { if (!val) return 'Content is required'; },
        }));

        const body = { name, version, content };
        const result = await withSpinner('Importing skill...', () =>
          client.request(`/v1/agents/${encodeURIComponent(agentId)}/skills/install`, 'POST', body), 'Skill imported.');

        showResult('Skill Imported', {
          Agent: agentId,
          Name: name,
          Version: version,
          ID: result.id || result.skill_id,
        });

        const approveNow = await p.confirm({
          message: 'Approve now?',
          initialValue: true,
        });
        handleCancel(approveNow);

        if (approveNow) {
          const skillId = result.id || result.skill_id;
          if (skillId) {
            await withSpinner('Approving skill...', () =>
              client.request(`/v1/agents/${encodeURIComponent(agentId)}/skills/approve/${encodeURIComponent(skillId)}`, 'POST'), 'Skill approved.');
          } else {
            p.log.warn('Could not determine skill ID for approval.');
          }
        }

        return result;
      }

      if (!agentId) throw new Error('Required: --agent');
      const body = {
        name: flags.name || 'unnamed',
        version: flags.version || '0.1.0',
        content: flags.content || '',
      };
      const result = await client.request(`/v1/agents/${encodeURIComponent(agentId)}/skills/install`, 'POST', body);
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    case 'approve': {
      let agentId = flags.agent;
      let skillId = flags.skill;

      if ((!agentId || !skillId) && isInteractive()) {
        if (!agentId) {
          agentId = await pickAgent(client, 'Select agent');
        }
        if (!skillId) {
          skillId = await pickSkill(client, agentId, 'Select skill to approve');
        }
      }

      if (!agentId || !skillId) throw new Error('Required: --agent, --skill');
      const result = await withSpinner('Approving skill...', () =>
        client.request(`/v1/agents/${encodeURIComponent(agentId)}/skills/approve/${encodeURIComponent(skillId)}`, 'POST'), 'Skill approved.');
      if (!isInteractive()) {
        console.log(`Skill ${skillId} approved.`);
      }
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
            const status = s.status === 'approved' ? '\u2705' : s.status === 'quarantined' ? '\u23f3' : '\u274c';
            p.log.info(`${status} ${s.name} v${s.version}  (${s.id})  [${s.status}]`);
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
