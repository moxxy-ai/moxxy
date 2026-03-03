import { p, handleCancel, withSpinner, showResult } from '../ui.js';
import { VALID_SCOPES } from './auth.js';
import { shellExportInstruction, shellProfileName } from '../platform.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

export function getMoxxyHome() {
  return process.env.MOXXY_HOME || join(homedir(), '.moxxy');
}

/**
 * Read the auth_mode from ~/.moxxy/config/gateway.json.
 * Returns 'token' | 'loopback'.
 * Env var MOXXY_LOOPBACK=true overrides the config file.
 */
export function readAuthMode() {
  if (process.env.MOXXY_LOOPBACK === 'true' || process.env.MOXXY_LOOPBACK === '1') {
    return 'loopback';
  }
  const configPath = join(getMoxxyHome(), 'config', 'gateway.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (config.auth_mode === 'loopback') return 'loopback';
  } catch {
    // config missing or unparseable = default to token
  }
  return 'token';
}

/**
 * Reset all tokens by clearing the api_tokens table via sqlite3 CLI.
 * This re-enables the bootstrap path (first token without auth).
 * Returns true if the reset succeeded.
 */
export function resetTokens() {
  const dbPath = join(getMoxxyHome(), 'moxxy.db');
  if (!existsSync(dbPath)) return false;
  try {
    execSync(`sqlite3 "${dbPath}" "DELETE FROM api_tokens;"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function runInit(client, args) {
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

  // Step 2: Check gateway connectivity (use unauthenticated probe = any response means reachable)
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

  // Step 2.5: Auth mode selection
  const authMode = await p.select({
    message: 'Authorization mode?',
    options: [
      { value: 'token', label: 'Token (default)', hint: 'API tokens required for all requests' },
      { value: 'loopback', label: 'Loopback', hint: 'no auth needed from localhost' },
    ],
  });
  handleCancel(authMode);

  // Persist auth mode to config
  const configPath = join(moxxyHome, 'config', 'gateway.json');
  try {
    writeFileSync(configPath, JSON.stringify({ auth_mode: authMode }, null, 2) + '\n');
    p.log.success(`Auth mode set to: ${authMode}`);
  } catch (err) {
    p.log.warn(`Could not write ${configPath}: ${err.message}`);
  }

  if (authMode === 'loopback') {
    p.note(
      'The gateway will accept all requests from localhost without a token.\n' +
      'Non-localhost requests will still require authentication.',
      'Loopback mode'
    );
  }

  // Step 3: Token bootstrap (skip if loopback mode)
  if (authMode !== 'loopback') {
  const createToken = await p.confirm({
    message: 'Create an API token?',
    initialValue: true,
  });
  handleCancel(createToken);

  if (createToken) {
    const scopes = ['*'];
    const ttl = undefined;

    const payload = { scopes };
    if (ttl) payload.ttl_seconds = ttl;

    // Try bootstrap (no auth) first, then with existing token
    const savedToken = client.token;
    let result;
    let created = false;

    // Attempt 1: bootstrap (no auth = works when DB has no tokens)
    client.token = '';
    try {
      result = await withSpinner('Creating token...', () =>
        client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');
      created = true;
    } catch (err) {
      if (err.status !== 401) {
        p.log.error(`Failed to create token: ${err.message}`);
      }
    }

    // Attempt 2: use existing MOXXY_TOKEN if bootstrap failed
    if (!created && savedToken) {
      client.token = savedToken;
      try {
        result = await withSpinner('Retrying with existing token...', () =>
          client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');
        created = true;
      } catch (err) {
        if (err.status !== 401) {
          p.log.error(`Failed to create token: ${err.message}`);
        }
      }
    }

    // Attempt 3: recovery menu = paste token or reset
    if (!created) {
      p.log.warn('Tokens already exist and your current token is missing or invalid.');
      const recovery = await p.select({
        message: 'How would you like to proceed?',
        options: [
          { value: 'reset', label: 'Reset tokens', hint: 'clear all existing tokens and create a new one' },
          { value: 'paste', label: 'Paste a token', hint: 'use an existing valid token' },
          { value: 'skip',  label: 'Skip',          hint: 'continue without a token' },
        ],
      });
      handleCancel(recovery);

      if (recovery === 'reset') {
        const confirm = await p.confirm({
          message: 'This will revoke ALL existing tokens. Continue?',
          initialValue: false,
        });
        handleCancel(confirm);

        if (confirm && resetTokens()) {
          p.log.success('All tokens cleared.');
          client.token = '';
          try {
            result = await withSpinner('Creating token...', () =>
              client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');
            created = true;
          } catch (err) {
            p.log.error(`Failed to create token: ${err.message}`);
          }
        } else if (confirm) {
          p.log.error('Could not reset tokens. Is sqlite3 installed?');
        }
      } else if (recovery === 'paste') {
        const pastedToken = await p.text({
          message: 'Paste a valid API token',
          placeholder: 'mox_...',
        });
        handleCancel(pastedToken);
        if (pastedToken) {
          client.token = pastedToken;
          try {
            result = await withSpinner('Creating token...', () =>
              client.request('/v1/auth/tokens', 'POST', payload), 'Token created.');
            created = true;
          } catch (err) {
            p.log.error(`Failed to create token: ${err.message}`);
          }
        }
      } else {
        p.log.info('Skipped. Create a token later with: moxxy auth token create');
      }
    }

    if (created) {
      // Use the new token for the rest of the init flow
      client.token = result.token;
      showResult('Your API Token', {
        ID: result.id,
        Token: result.token,
        Scopes: scopes.join(', '),
      });

      p.note(
        `# Add to ${shellProfileName()}:\n${shellExportInstruction('MOXXY_TOKEN', result.token)}`,
        'Save your token'
      );
      p.log.warn('This token will not be shown again. Save it now.');
    }
  }
  } // end authMode !== 'loopback'

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

        // Interactive pairing
        p.note(
          '1. Open your Telegram bot and send /start\n' +
          '2. You will receive a 6-digit pairing code',
          'Pair your chat'
        );

        const pairCode = await p.text({
          message: 'Enter the 6-digit pairing code',
          placeholder: '123456',
          validate: (v) => {
            if (!v || v.trim().length === 0) return 'Code is required';
          },
        });
        handleCancel(pairCode);

        // Pick an agent to bind
        let agentId;
        try {
          const agents = await withSpinner('Fetching agents...', () =>
            client.listAgents(), 'Agents loaded.');
          if (!agents || agents.length === 0) {
            p.log.warn('No agents found. Create one first with: moxxy agent create');
            p.log.info(`Pair later with: moxxy channel pair --code ${pairCode} --agent <agent-id>`);
          } else {
            agentId = await p.select({
              message: 'Select agent to bind',
              options: agents.map(a => ({
                value: a.id,
                label: `${a.id.substring(0, 8)} (${a.provider_id}/${a.model_id})`,
              })),
            });
            handleCancel(agentId);
          }
        } catch (err) {
          p.log.warn(`Could not list agents: ${err.message}`);
          p.log.info(`Pair later with: moxxy channel pair --code ${pairCode} --agent <agent-id>`);
        }

        if (agentId) {
          try {
            const pairResult = await withSpinner('Pairing...', () =>
              client.request(`/v1/channels/${result.id}/pair`, 'POST', {
                code: pairCode,
                agent_id: agentId,
              }), 'Paired successfully.');
            showResult('Channel Paired', {
              'Binding ID': pairResult.id,
              Agent: pairResult.agent_id,
              'External Chat': pairResult.external_chat_id,
            });
          } catch (err) {
            p.log.error(`Failed to pair: ${err.message}`);
            p.log.info(`Try again with: moxxy channel pair --code ${pairCode} --agent ${agentId}`);
          }
        }
      } catch (err) {
        p.log.error(`Failed to register channel: ${err.message}`);
      }
    } else {
      p.log.info('Discord channel support is coming soon.');
    }
  }

  p.outro('Setup complete. Run moxxy to see available commands.');
}
