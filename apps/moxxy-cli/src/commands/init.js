import { p, handleCancel, withSpinner, showResult } from '../ui.js';
import { LOGO } from '../cli.js';
import { VALID_SCOPES } from './auth.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function getMoxxyHome() {
  return process.env.MOXXY_HOME || join(homedir(), '.moxxy');
}

export async function runInit(client, args) {
  console.log(LOGO);
  p.intro('Welcome to Moxxy');

  // Step 0: Create ~/.moxxy directory structure
  const moxxyHome = getMoxxyHome();
  try {
    mkdirSync(join(moxxyHome, 'agents'), { recursive: true });
    mkdirSync(join(moxxyHome, 'config'), { recursive: true });
    p.log.success(`Moxxy home: ${moxxyHome}`);
  } catch (err) {
    p.log.warn(`Could not create ${moxxyHome}: ${err.message}`);
  }

  // Step 1: Check/configure API URL
  const useDefault = await p.confirm({
    message: `Use gateway at ${client.baseUrl}?`,
    initialValue: true,
  });
  handleCancel(useDefault);

  if (!useDefault) {
    const apiUrl = await p.text({
      message: 'Enter gateway URL',
      placeholder: 'http://localhost:3000',
      validate: (val) => {
        try { new URL(val); } catch { return 'Must be a valid URL'; }
      },
    });
    handleCancel(apiUrl);
    client.baseUrl = apiUrl;
  }

  // Step 2: Check gateway connectivity (use unauthenticated probe — any response means reachable)
  let gatewayReachable = false;
  try {
    await withSpinner('Checking gateway connection...', async () => {
      const resp = await fetch(`${client.baseUrl}/v1/providers`);
      // Any HTTP response (even 401) means the gateway is running
      if (resp) gatewayReachable = true;
    }, 'Gateway is reachable.');
  } catch {
    p.log.warn('Gateway is not reachable. Start it with: cargo run -p moxxy-gateway');
    p.log.info('You can continue setup and connect later.');
  }

  // Step 3: Token bootstrap
  const createToken = await p.confirm({
    message: 'Create an API token?',
    initialValue: true,
  });
  handleCancel(createToken);

  if (createToken) {
    const scopes = await p.multiselect({
      message: 'Select token scopes',
      options: VALID_SCOPES.map(s => ({ value: s, label: s })),
      required: true,
    });
    handleCancel(scopes);

    const ttlInput = await p.text({
      message: 'Token TTL in seconds',
      placeholder: 'leave empty for no expiry',
    });
    handleCancel(ttlInput);
    const ttl = ttlInput ? parseInt(ttlInput, 10) : undefined;

    try {
      const payload = { scopes };
      if (ttl) payload.ttl_seconds = ttl;
      const result = await withSpinner('Creating token...', () =>
        client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');

      showResult('Your API Token', {
        ID: result.id,
        Token: result.token,
        Scopes: scopes.join(', '),
      });

      p.note(`export MOXXY_TOKEN="${result.token}"`, 'Add to your shell profile');
    } catch (err) {
      p.log.error(`Failed to create token: ${err.message}`);
    }
  }

  // Step 4: Channel setup (optional)
  const setupChannel = await p.confirm({
    message: 'Set up a messaging channel (Telegram/Discord)?',
    initialValue: false,
  });
  handleCancel(setupChannel);

  if (setupChannel) {
    const channelType = await p.select({
      message: 'Channel type',
      options: [
        { value: 'telegram', label: 'Telegram', hint: 'BotFather bot token required' },
        { value: 'discord', label: 'Discord', hint: 'coming soon (scaffold)' },
      ],
    });
    handleCancel(channelType);

    if (channelType === 'telegram') {
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
        const result = await withSpinner('Registering Telegram channel...', () =>
          client.request('/v1/channels', 'POST', {
            channel_type: 'telegram',
            display_name: displayName || 'Telegram Bot',
            bot_token: botToken,
          }), 'Channel registered.');

        showResult('Telegram Channel', { ID: result.id, Status: result.status });
        p.note(
          '1. Open your Telegram bot and send /start\n' +
          '2. Copy the 6-digit code\n' +
          '3. Run: moxxy channel pair --code <code> --agent <agent-id>',
          'Next: Pair your chat'
        );
      } catch (err) {
        p.log.error(`Failed to register channel: ${err.message}`);
      }
    } else {
      p.log.info('Discord channel support is coming soon.');
    }
  }

  p.outro('Setup complete. Run moxxy to see available commands.');
}
