import { p, handleCancel, withSpinner, showResult } from '../ui.js';
import { parseFlags } from './auth.js';

export async function runChannel(client, args) {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'create':
      await createChannel(client, rest);
      break;
    case 'list':
      await listChannels(client, rest);
      break;
    case 'pair':
      await pairChannel(client, rest);
      break;
    case 'delete':
      await deleteChannel(client, rest);
      break;
    case 'bindings':
      await listBindings(client, rest);
      break;
    case 'unbind':
      await unbindChannel(client, rest);
      break;
    default:
      console.log(`Usage: moxxy channel [create|list|pair|delete|bindings|unbind]

Commands:
  create                              Create a channel (Telegram/Discord)
  list                                List all channels
  pair --code <code> --agent <id>     Pair a chat to an agent
  delete <id>                         Delete a channel
  bindings <id>                       List bindings for a channel
  unbind <channel-id> <binding-id>    Unbind a chat`);
  }
}

async function createChannel(client, args) {
  const channelType = await p.select({
    message: 'Channel type',
    options: [
      { value: 'telegram', label: 'Telegram', hint: 'BotFather bot token required' },
      { value: 'discord', label: 'Discord', hint: 'coming soon (scaffold)' },
    ],
  });
  handleCancel(channelType);

  if (channelType === 'discord') {
    p.log.info('Discord channel support is coming soon.');
    return;
  }

  p.note(
    '1. Open Telegram and talk to @BotFather\n' +
    '2. Send /newbot and follow the prompts\n' +
    '3. Copy the bot token',
    'Telegram Bot Setup'
  );

  const botToken = await p.password({
    message: 'Paste your Telegram bot token',
  });
  handleCancel(botToken);

  const displayName = await p.text({
    message: 'Display name for this channel',
    placeholder: 'My Moxxy Bot',
  });
  handleCancel(displayName);

  try {
    const result = await withSpinner('Creating channel...', () =>
      client.request('/v1/channels', 'POST', {
        channel_type: channelType,
        display_name: displayName || 'Telegram Bot',
        bot_token: botToken,
      }), 'Channel created.');

    showResult('Channel Created', {
      ID: result.id,
      Type: result.channel_type,
      Name: result.display_name,
      Status: result.status,
    });

    p.note(
      '1. Open your Telegram bot and send /start\n' +
      '2. Copy the 6-digit pairing code\n' +
      `3. Run: moxxy channel pair --code <code> --agent <agent-id>`,
      'Next: Pair your chat'
    );
  } catch (err) {
    p.log.error(`Failed to create channel: ${err.message}`);
  }
}

async function listChannels(client, args) {
  const flags = parseFlags(args);
  try {
    const channels = await client.request('/v1/channels', 'GET');
    if (flags.json) {
      console.log(JSON.stringify(channels, null, 2));
      return;
    }
    if (channels.length === 0) {
      p.log.info('No channels found. Create one with: moxxy channel create');
      return;
    }
    for (const ch of channels) {
      p.log.info(`${ch.id} | ${ch.channel_type} | ${ch.display_name} | ${ch.status}`);
    }
  } catch (err) {
    p.log.error(`Failed to list channels: ${err.message}`);
  }
}

async function pairChannel(client, args) {
  const flags = parseFlags(args);
  let code = flags.code;
  let agentId = flags.agent;

  if (!code) {
    code = await p.text({ message: 'Enter 6-digit pairing code' });
    handleCancel(code);
  }

  if (!agentId) {
    try {
      const agents = await client.listAgents();
      if (agents.length === 0) {
        p.log.error('No agents found. Create one first: moxxy agent create');
        return;
      }
      agentId = await p.select({
        message: 'Select agent to bind',
        options: agents.map(a => ({
          value: a.id,
          label: `${a.id.substring(0, 8)} (${a.provider_id}/${a.model_id})`,
        })),
      });
      handleCancel(agentId);
    } catch (err) {
      p.log.error(`Failed to list agents: ${err.message}`);
      return;
    }
  }

  // Find the channel to pair with
  let channelId;
  try {
    const channels = await client.request('/v1/channels', 'GET');
    if (channels.length === 0) {
      p.log.error('No channels found. Create one first: moxxy channel create');
      return;
    }
    if (channels.length === 1) {
      channelId = channels[0].id;
    } else {
      channelId = await p.select({
        message: 'Select channel',
        options: channels.map(c => ({
          value: c.id,
          label: `${c.id.substring(0, 8)} (${c.channel_type} - ${c.display_name})`,
        })),
      });
      handleCancel(channelId);
    }
  } catch (err) {
    p.log.error(`Failed to list channels: ${err.message}`);
    return;
  }

  try {
    const result = await withSpinner('Pairing...', () =>
      client.request(`/v1/channels/${channelId}/pair`, 'POST', {
        code,
        agent_id: agentId,
      }), 'Paired successfully.');

    showResult('Channel Paired', {
      'Binding ID': result.id,
      Channel: result.channel_id,
      Agent: result.agent_id,
      'External Chat': result.external_chat_id,
    });
  } catch (err) {
    p.log.error(`Failed to pair: ${err.message}`);
  }
}

async function deleteChannel(client, args) {
  const [channelId] = args;
  if (!channelId) {
    p.log.error('Usage: moxxy channel delete <channel-id>');
    return;
  }

  try {
    await withSpinner('Deleting channel...', () =>
      client.request(`/v1/channels/${channelId}`, 'DELETE'), 'Channel deleted.');
  } catch (err) {
    p.log.error(`Failed to delete channel: ${err.message}`);
  }
}

async function listBindings(client, args) {
  const [channelId] = args;
  if (!channelId) {
    p.log.error('Usage: moxxy channel bindings <channel-id>');
    return;
  }

  try {
    const bindings = await client.request(`/v1/channels/${channelId}/bindings`, 'GET');
    if (bindings.length === 0) {
      p.log.info('No bindings found for this channel.');
      return;
    }
    for (const b of bindings) {
      p.log.info(`${b.id} | Agent: ${b.agent_id} | Chat: ${b.external_chat_id} | ${b.status}`);
    }
  } catch (err) {
    p.log.error(`Failed to list bindings: ${err.message}`);
  }
}

async function unbindChannel(client, args) {
  const [channelId, bindingId] = args;
  if (!channelId || !bindingId) {
    p.log.error('Usage: moxxy channel unbind <channel-id> <binding-id>');
    return;
  }

  try {
    await withSpinner('Unbinding...', () =>
      client.request(`/v1/channels/${channelId}/bindings/${bindingId}`, 'DELETE'), 'Unbound.');
  } catch (err) {
    p.log.error(`Failed to unbind: ${err.message}`);
  }
}
