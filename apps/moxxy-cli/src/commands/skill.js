/**
 * Skill commands: import/approve/list.
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

export async function runSkill(client, args) {
  const [action, ...rest] = args;
  const flags = parseFlags(rest);

  switch (action) {
    case 'import': {
      const agentId = flags.agent;
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
      const agentId = flags.agent;
      const skillId = flags.skill;
      if (!agentId || !skillId) throw new Error('Required: --agent, --skill');
      const result = await client.request(`/v1/agents/${encodeURIComponent(agentId)}/skills/approve/${encodeURIComponent(skillId)}`, 'POST');
      console.log(`Skill ${skillId} approved.`);
      return result;
    }

    case 'list': {
      console.error('Skill list not yet implemented.');
      process.exitCode = 1;
      break;
    }

    default:
      console.error('Usage: moxxy skill <import|approve|list>');
      process.exitCode = 1;
  }
}
