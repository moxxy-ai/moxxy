import { p, handleCancel, isInteractive, withSpinner, showResult } from '../ui.js';
import { showHelp } from '../help.js';
import { parseFlags } from './auth.js';

export async function runChannel(client, args) {
  let [subcommand, ...rest] = args;

  if (!subcommand && isInteractive()) {
    subcommand = await p.select({
      message: 'Channel action',
      options: [
        { value: 'list',     label: 'List channels',   hint: 'show registered channels' },
        { value: 'create',   label: 'Create channel',  hint: 'register a new channel' },
        { value: 'pair',     label: 'Pair channel',     hint: 'bind a channel to an agent' },
        { value: 'bindings', label: 'List bindings',    hint: 'show channel-agent bindings' },
        { value: 'unbind',   label: 'Unbind channel',   hint: 'remove a channel-agent binding' },
        { value: 'delete',   label: 'Delete channel',   hint: 'remove a channel' },
      ],
    });
    handleCancel(subcommand);
  }

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
      showHelp('channel', p);
  }
}

async function createChannel(client, args) {
  const channelType = await p.select({
    message: 'Channel type',
    options: [
      { value: 'telegram', label: 'Telegram', hint: 'BotFather bot token required' },
      { value: 'discord', label: 'Discord', hint: 'Discord bot token required' },
      { value: 'whatsapp', label: 'WhatsApp', hint: 'WhatsApp Business API token required' },
    ],
  });
  handleCancel(channelType);

  // Step 1: Select agent to bind
  let agentId;
  try {
    const agents = await client.listAgents();
    if (agents.length === 0) {
      p.log.error('No agents found. Create one first: moxxy agent create');
      return;
    }
    agentId = await p.select({
      message: 'Select agent to bind',
      options: agents.map(a => ({
        value: a.name,
        label: `${a.name} (${a.provider_id}/${a.model_id})`,
      })),
    });
    handleCancel(agentId);
  } catch (err) {
    p.log.error(`Failed to list agents: ${err.message}`);
    return;
  }

  // Step 2: Get credentials based on channel type
  let botToken, displayName, config;

  if (channelType === 'telegram') {
    p.note(
      '1. Open Telegram and talk to @BotFather\n' +
      '2. Send /newbot and follow the prompts\n' +
      '3. Copy the bot token',
      'Telegram Bot Setup'
    );

    botToken = await p.password({
      message: 'Paste your Telegram bot token',
    });
    handleCancel(botToken);
  } else if (channelType === 'discord') {
    p.note(
      '1. Go to https://discord.com/developers/applications\n' +
      '2. Create a new application → Bot → copy the bot token\n' +
      '3. Enable MESSAGE CONTENT intent under Bot → Privileged Intents\n' +
      '4. Invite the bot to your server with the Messages scope',
      'Discord Bot Setup'
    );

    botToken = await p.password({
      message: 'Paste your Discord bot token',
    });
    handleCancel(botToken);
  } else if (channelType === 'whatsapp') {
    p.note(
      '1. Go to https://developers.facebook.com and create an app\n' +
      '2. Add the WhatsApp product to your app\n' +
      '3. Copy the permanent access token and Phone Number ID\n' +
      '4. Configure the webhook URL to: <your-moxxy-url>/v1/channels/whatsapp/webhook',
      'WhatsApp Business API Setup'
    );

    botToken = await p.password({
      message: 'Paste your WhatsApp access token',
    });
    handleCancel(botToken);

    const phoneNumberId = await p.text({
      message: 'Phone Number ID (from WhatsApp Business API)',
    });
    handleCancel(phoneNumberId);

    const verifyToken = await p.text({
      message: 'Webhook verify token (you choose this, used to verify the webhook)',
      placeholder: 'my-verify-token',
    });
    handleCancel(verifyToken);

    config = {
      phone_number_id: phoneNumberId,
      verify_token: verifyToken || undefined,
    };
  }

  displayName = await p.text({
    message: 'Display name for this channel',
    placeholder: channelType === 'telegram' ? 'My Telegram Bot' :
                 channelType === 'discord' ? 'My Discord Bot' : 'My WhatsApp Bot',
  });
  handleCancel(displayName);

  const defaultName = channelType === 'telegram' ? 'Telegram Bot' :
                      channelType === 'discord' ? 'Discord Bot' : 'WhatsApp Bot';

  // Step 3: Create channel
  let channel;
  try {
    channel = await withSpinner('Creating channel...', () =>
      client.request('/v1/channels', 'POST', {
        channel_type: channelType,
        display_name: displayName || defaultName,
        bot_token: botToken,
        ...(config ? { config } : {}),
      }), 'Channel created.');

    showResult('Channel Created', {
      ID: channel.id,
      Type: channel.channel_type,
      Name: channel.display_name,
      Status: channel.status,
    });
  } catch (err) {
    p.log.error(`Failed to create channel: ${err.message}`);
    return;
  }

  // Step 4: Wait for pairing code
  if (channelType === 'telegram') {
    p.note(
      '1. Open your Telegram bot and send /start\n' +
      '2. Copy the 6-digit pairing code',
      'Pair your chat'
    );
  } else if (channelType === 'discord') {
    p.note(
      '1. Send a message to your Discord bot or in a channel it can see\n' +
      '2. The bot will respond with a pairing code if not yet paired\n' +
      '3. Copy the 6-digit pairing code',
      'Pair your chat'
    );
  } else if (channelType === 'whatsapp') {
    p.note(
      '1. Send a message to your WhatsApp number\n' +
      '2. The bot will respond with a pairing code\n' +
      '3. Copy the 6-digit pairing code',
      'Pair your chat'
    );
  }

  const code = await p.text({
    message: 'Enter 6-digit pairing code',
    validate: (v) => {
      if (!v || v.trim().length === 0) return 'Code is required';
    },
  });
  handleCancel(code);

  // Step 5: Pair
  try {
    const result = await withSpinner('Pairing...', () =>
      client.request(`/v1/channels/${channel.id}/pair`, 'POST', {
        code: code.trim(),
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
          value: a.name,
          label: `${a.name} (${a.provider_id}/${a.model_id})`,
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
