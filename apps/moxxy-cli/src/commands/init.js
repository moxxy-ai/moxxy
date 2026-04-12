import { p, handleCancel, withSpinner, showResult } from '../ui.js';
import { VALID_SCOPES } from './auth.js';
import { BUILTIN_PROVIDERS, ANTHROPIC_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID, loginAnthropic, loginOpenAiCodex, checkProviderCredentials, resolveBuiltinProviderModels } from './provider.js';
import { shellExportInstruction, shellProfileName } from '../platform.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, copyFileSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import { execSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

export function getMoxxyHome() {
  return process.env.MOXXY_HOME || join(homedir(), '.moxxy');
}

/**
 * Read the auth_mode from ~/.moxxy/config/gateway.yaml.
 * Returns 'token' | 'loopback'.
 * Env var MOXXY_LOOPBACK=true overrides the config file.
 */
export function readAuthMode() {
  if (process.env.MOXXY_LOOPBACK === 'true' || process.env.MOXXY_LOOPBACK === '1') {
    return 'loopback';
  }
  const configPath = join(getMoxxyHome(), 'config', 'gateway.yaml');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const match = raw.match(/^auth_mode:\s*(.+)$/m);
    if (match && match[1].trim() === 'loopback') return 'loopback';
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

function detectGatewayPlatform() {
  const osMap = { darwin: 'darwin', linux: 'linux' };
  const archMap = { arm64: 'arm64', x64: 'x86_64' };
  const os = osMap[platform()] || platform();
  const cpuArch = archMap[arch()] || arch();
  const binaryName = `moxxy-gateway-${os}-${cpuArch}`;
  return { os, arch: cpuArch, binaryName };
}

const GITHUB_REPO = process.env.MOXXY_GITHUB_REPO || 'moxxy-ai/moxxy';
const GITHUB_API = 'https://api.github.com';

async function fetchLatestReleaseAssetUrl(binaryName) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'moxxy-cli' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`;
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });

  if (resp.status === 403) {
    const remaining = resp.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      throw new Error('GitHub API rate limit exceeded. Set GITHUB_TOKEN env var to increase the limit.');
    }
    throw new Error(`GitHub API returned 403: ${resp.statusText}`);
  }
  if (resp.status === 404) {
    throw new Error('No releases found.');
  }
  if (!resp.ok) {
    throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
  }

  const release = await resp.json();
  const asset = release.assets.find(a => a.name === binaryName);
  if (!asset) {
    const available = release.assets.map(a => a.name).join(', ');
    throw new Error(`No binary for this platform (${binaryName}). Available: ${available}`);
  }
  return { url: asset.browser_download_url, version: release.tag_name };
}

async function installGatewayBinary(moxxyHome) {
  const { binaryName } = detectGatewayPlatform();
  const binDir = join(moxxyHome, 'bin');
  const binName = platform() === 'win32' ? 'moxxy-gateway.exe' : 'moxxy-gateway';
  const binPath = join(binDir, binName);

  // MOXXY_GATEWAY_URL overrides GitHub releases (for local dev / custom builds)
  const overrideUrl = process.env.MOXXY_GATEWAY_URL;

  if (existsSync(binPath) && !overrideUrl) {
    p.log.success(`Gateway binary already installed: ${binPath}`);
    return true;
  }

  mkdirSync(binDir, { recursive: true });
  const tmpPath = binPath + '.download';

  try {
    let downloadUrl;
    let version;

    const isLocalPath = overrideUrl && !overrideUrl.startsWith('http://') && !overrideUrl.startsWith('https://');

    if (isLocalPath) {
      const srcPath = resolve(overrideUrl);
      if (!existsSync(srcPath)) {
        throw new Error(`Local binary not found: ${srcPath}`);
      }
      p.log.info(`Copying local gateway binary: ${srcPath}`);
      copyFileSync(srcPath, binPath);
      chmodSync(binPath, 0o755);
      p.log.success(`Gateway installed: ${binPath}`);
    } else {
      if (overrideUrl) {
        downloadUrl = overrideUrl;
        p.log.info(`Using custom gateway URL: ${overrideUrl}`);
      } else {
        const release = await withSpinner('Fetching latest release...', () =>
          fetchLatestReleaseAssetUrl(binaryName), 'Release found.');
        downloadUrl = release.url;
        version = release.version;
      }

      const headers = { 'User-Agent': 'moxxy-cli', 'Accept': 'application/octet-stream' };
      if (!overrideUrl) {
        const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      await withSpinner(`Downloading gateway${version ? ` ${version}` : ''} (${binaryName})...`, async () => {
        const resp = await fetch(downloadUrl, { headers, signal: AbortSignal.timeout(120000) });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }
        const fileStream = createWriteStream(tmpPath);
        await pipeline(resp.body, fileStream);
      }, 'Gateway downloaded.');

      const { renameSync } = await import('node:fs');
      renameSync(tmpPath, binPath);
      chmodSync(binPath, 0o755);
      p.log.success(`Gateway installed: ${binPath}`);
    }
    return true;
  } catch (err) {
    // Clean up partial download
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(tmpPath); } catch { /* ignore */ }
    p.log.error(`Failed to download gateway: ${err.message}`);
    return false;
  }
}

export async function runInit(client, args) {
  p.intro('Welcome to Moxxy');

  // Step 0: Create ~/.moxxy directory structure
  p.note(
    'The ~/.moxxy directory stores agent configs, secrets, and metadata.\n' +
    'It will be created automatically if it doesn\'t exist.',
    'Home Directory'
  );
  const moxxyHome = getMoxxyHome();
  try {
    mkdirSync(join(moxxyHome, 'agents'), { recursive: true });
    mkdirSync(join(moxxyHome, 'config'), { recursive: true });
    p.log.success(`Moxxy home: ${moxxyHome}`);
  } catch (err) {
    p.log.warn(`Could not create ${moxxyHome}: ${err.message}`);
  }

  // Step 1: Install gateway binary
  p.note(
    'The gateway is the backend service that manages agents, routing,\n' +
    'and tool execution. It will be downloaded and installed automatically.',
    'Gateway Installation'
  );
  const gatewayInstalled = await installGatewayBinary(moxxyHome);

  // Step 1.5: Check/configure API URL
  p.note(
    'The gateway listens on a local port.\n' +
    'The default is http://localhost:3000.',
    'Gateway Connection'
  );
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

  // Step 2: Start gateway and check connectivity
  let gatewayReachable = false;
  if (gatewayInstalled) {
    const startIt = await p.confirm({
      message: 'Start the gateway now?',
      initialValue: true,
    });
    handleCancel(startIt);

    if (startIt) {
      try {
        const { startGateway } = await import('./gateway.js');
        await startGateway();
        gatewayReachable = true;
      } catch (err) {
        p.log.warn(`Could not start gateway: ${err.message}`);
        p.log.info('You can start it later with: moxxy gateway start');
      }
    }
  }

  if (!gatewayReachable) {
    try {
      await withSpinner('Checking gateway connection...', async () => {
        const resp = await fetch(`${client.baseUrl}/v1/providers`);
        if (resp) gatewayReachable = true;
      }, 'Gateway is reachable.');
    } catch {
      p.log.warn('Gateway is not reachable. Start it with: moxxy gateway start');
      p.log.info('You can continue setup and connect later.');
    }
  }

  // Step 2.5: Auth mode selection
  p.note(
    'Token mode requires an API token for every request (more secure).\n' +
    'Loopback mode skips auth for localhost requests (easier for local dev).',
    'Authentication'
  );
  const authMode = await p.select({
    message: 'Authorization mode?',
    options: [
      { value: 'token', label: 'Token (default)', hint: 'API tokens required for all requests' },
      { value: 'loopback', label: 'Loopback', hint: 'no auth needed from localhost' },
    ],
  });
  handleCancel(authMode);

  // Persist auth mode to config
  const configPath = join(moxxyHome, 'config', 'gateway.yaml');
  try {
    writeFileSync(configPath, `auth_mode: ${authMode}\n`);
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
  p.note(
    'API tokens authenticate CLI requests to the gateway.\n' +
    'A wildcard (*) token grants full access to all endpoints.',
    'API Token'
  );
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

  // Step 4: Provider installation (optional)
  let installedProviderId = null;

  p.note(
    'Providers connect Moxxy to LLM services like Anthropic, OpenAI, or Google.\n' +
    'You need at least one provider installed before creating agents.',
    'Provider Setup'
  );

  const installProvider = await p.confirm({
    message: 'Install an LLM provider?',
    initialValue: true,
  });
  handleCancel(installProvider);

  if (installProvider) {
    if (authMode === 'token' && !client.token) {
      p.log.warn('Provider install requires a token in token mode. Skipping.');
      p.log.info('Create a token first, then run: moxxy provider install');
    } else {
      const providerChoice = await p.select({
        message: 'Select a provider to install',
        options: [
          ...BUILTIN_PROVIDERS.map(bp => ({
            value: bp.id,
            label: bp.display_name,
            hint: `${bp.models.length} models`,
          })),
          { value: '__skip__', label: 'Skip', hint: 'install a provider later' },
        ],
      });
      handleCancel(providerChoice);

      if (providerChoice !== '__skip__') {
        const builtin = BUILTIN_PROVIDERS.find(bp => bp.id === providerChoice);

        // Providers with dedicated login flows (OAuth / validated API key)
        if (builtin.oauth_login || builtin.api_key_login) {
          try {
            const flags = {};
            let result;
            if (providerChoice === ANTHROPIC_PROVIDER_ID) {
              result = await loginAnthropic(client, flags);
            } else if (providerChoice === OPENAI_CODEX_PROVIDER_ID) {
              result = await loginOpenAiCodex(client, flags);
            }
            if (result?.provider_id) {
              installedProviderId = result.provider_id;
            }
          } catch (err) {
            p.log.error(`Failed to install provider: ${err.message}`);
          }
        } else {
          // Generic provider flow (no special login)
          const availableModels = await resolveBuiltinProviderModels(builtin);
          const CUSTOM_MODEL_VALUE = '__custom_model__';
          const selectedModels = handleCancel(await p.multiselect({
            message: 'Select models to install',
            options: [
              ...availableModels.map(m => ({
                value: m.model_id,
                label: m.display_name,
                hint: m.model_id,
              })),
              { value: CUSTOM_MODEL_VALUE, label: 'Custom model ID', hint: 'enter a model ID manually' },
            ],
            required: true,
          }));

          const models = availableModels
            .filter(m => selectedModels.includes(m.model_id))
            .map(m => ({
              ...m,
              metadata: m.metadata || (builtin.api_base ? { api_base: builtin.api_base } : {}),
            }));

          // Handle custom model
          if (selectedModels.includes(CUSTOM_MODEL_VALUE)) {
            const customModelId = handleCancel(await p.text({
              message: 'Custom model ID',
              placeholder: 'e.g. ft:gpt-4o:my-org:custom-suffix',
              validate: (v) => { if (!v.trim()) return 'Required'; },
            }));

            const customModelName = handleCancel(await p.text({
              message: 'Display name for this model',
              initialValue: customModelId,
            }));

            models.push({
              model_id: customModelId,
              display_name: customModelName || customModelId,
              metadata: builtin.api_base ? { api_base: builtin.api_base, custom: true } : { custom: true },
            });
          }

          // Verify credentials (binary check for CLI providers, API key for others)
          const credOk = await checkProviderCredentials(builtin, client);
          if (!credOk) return;

          // Install provider
          try {
            await withSpinner(`Installing ${builtin.display_name}...`, () =>
              client.installProvider(builtin.id, builtin.display_name, models),
              `${builtin.display_name} installed.`
            );

            installedProviderId = builtin.id;

            const resultInfo = {
              ID: builtin.id,
              Name: builtin.display_name,
              Models: models.map(m => m.model_id).join(', '),
            };
            if (builtin.api_key_env) resultInfo['API Key Env'] = builtin.api_key_env;
            if (builtin.cli_binary) resultInfo['CLI Binary'] = builtin.cli_binary;
            showResult('Provider Installed', resultInfo);
          } catch (err) {
            p.log.error(`Failed to install provider: ${err.message}`);
          }
        }
      }
    }
  }

  // Step 5: Agent creation (optional)
  p.note(
    'Agents are LLM-powered workers that use tools and skills to complete tasks.\n' +
    'Each agent is bound to a provider and model.',
    'Your First Agent'
  );

  const createAgent = await p.confirm({
    message: 'Create your first agent?',
    initialValue: true,
  });
  handleCancel(createAgent);

  if (createAgent) {
    if (authMode === 'token' && !client.token) {
      p.log.warn('Agent creation requires a token in token mode. Skipping.');
      p.log.info('Create a token first, then run: moxxy agent create');
    } else {
      // Check for available providers
      let agentProviderId = installedProviderId;

      if (!agentProviderId) {
        try {
          const providers = await withSpinner('Fetching providers...', () =>
            client.listProviders(), 'Providers loaded.');
          if (!providers || providers.length === 0) {
            p.log.warn('No providers installed. Install one first with: moxxy provider install');
            agentProviderId = null;
          } else {
            agentProviderId = handleCancel(await p.select({
              message: 'Select a provider',
              options: providers.map(pr => ({
                value: pr.id,
                label: pr.display_name || pr.id,
              })),
            }));
          }
        } catch (err) {
          p.log.warn(`Could not list providers: ${err.message}`);
        }
      }

      if (agentProviderId) {
        // Agent name
        const agentName = handleCancel(await p.text({
          message: 'Agent name',
          placeholder: 'my-agent',
          validate: (v) => {
            if (!v || v.trim().length === 0) return 'Required';
            if (v.length > 64) return 'Max 64 characters';
            if (!/^[a-z][a-z0-9-]*$/.test(v)) return 'Lowercase alphanumeric and hyphens, must start with a letter';
          },
        }));

        // Model selection (live from API)
        let agentModelId;
        try {
          const models = await withSpinner('Fetching models...', () =>
            client.listModels(agentProviderId), 'Models loaded.');

          const CUSTOM_MODEL_VALUE = '__custom_model__';
          const modelOptions = [
            ...(models || []).map(m => ({
              value: m.model_id,
              label: m.display_name || m.model_id,
              hint: m.model_id,
            })),
            { value: CUSTOM_MODEL_VALUE, label: 'Custom model ID', hint: 'enter a model ID manually' },
          ];

          const modelChoice = handleCancel(await p.select({
            message: 'Select a model',
            options: modelOptions,
          }));

          if (modelChoice === CUSTOM_MODEL_VALUE) {
            agentModelId = handleCancel(await p.text({
              message: 'Custom model ID',
              placeholder: 'e.g. claude-sonnet-4-20250514',
              validate: (v) => { if (!v.trim()) return 'Required'; },
            }));
          } else {
            agentModelId = modelChoice;
          }
        } catch (err) {
          p.log.warn(`Could not fetch models: ${err.message}`);
          agentModelId = handleCancel(await p.text({
            message: 'Model ID',
            placeholder: 'e.g. claude-sonnet-4-20250514',
            validate: (v) => { if (!v.trim()) return 'Required'; },
          }));
        }

        // Persona (optional)
        const persona = handleCancel(await p.text({
          message: 'Persona (optional)',
          placeholder: 'e.g. A helpful coding assistant',
        }));

        // Create the agent
        try {
          const opts = {};
          if (persona && persona.trim()) opts.persona = persona.trim();

          const agentResult = await withSpinner('Creating agent...', () =>
            client.createAgent(agentProviderId, agentModelId, agentName, opts),
            'Agent created.'
          );

          showResult('Agent Created', {
            Name: agentResult.name,
            Provider: agentResult.provider_id,
            Model: agentResult.model_id,
            Status: agentResult.status,
          });
        } catch (err) {
          p.log.error(`Failed to create agent: ${err.message}`);
        }
      }
    }
  }

  // Step 6: Channel setup (optional)
  p.note(
    'Channels enable agent communication via Telegram or Discord.\n' +
    'You can set up channels later with: moxxy channel create',
    'Channels'
  );
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
                value: a.name,
                label: `${a.name} (${a.provider_id}/${a.model_id})`,
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

  // Step 7: Browser rendering (optional)
  p.note(
    'Browser rendering enables agents to load JavaScript-heavy websites\n' +
    'using a headless Chrome browser. This requires Chrome/Chromium.\n' +
    'Without it, agents can still fetch pages via HTTP (works for most sites).',
    'Browser Rendering'
  );

  const enableBrowser = await p.confirm({
    message: 'Enable browser rendering capabilities?',
    initialValue: false,
  });
  handleCancel(enableBrowser);

  if (enableBrowser) {
    const chromePath = detectChromeBinary(moxxyHome);

    if (chromePath) {
      p.log.success(`Chrome found: ${chromePath}`);
      saveBrowserRenderingSetting(moxxyHome, true);
      p.log.success('Browser rendering enabled.');
    } else {
      p.log.warn('Chrome/Chromium not found on this system.');

      const downloadChrome = await p.confirm({
        message: 'Download Chromium (~150MB) to ~/.moxxy/chromium/?',
        initialValue: true,
      });
      handleCancel(downloadChrome);

      if (downloadChrome) {
        const installed = await installChromium(moxxyHome);
        if (installed) {
          saveBrowserRenderingSetting(moxxyHome, true);
          p.log.success('Browser rendering enabled.');
        } else {
          p.log.warn('Chromium install failed. You can retry later with: moxxy settings browser-rendering');
        }
      } else {
        p.log.info('Skipped. Install Chrome manually or run: moxxy settings browser-rendering');
      }
    }
  }

  // Step 8: Voice messages (optional)
  p.note(
    'Voice messages let users send audio to the agent on any channel\n' +
    '(Telegram voice notes, the TUI /voice command, or direct audio upload\n' +
    'to the gateway). The audio is transcribed to text before the agent\n' +
    'sees it. The agent does not reply with voice.',
    'Voice Messages (Speech-to-Text)'
  );

  const enableVoice = await p.confirm({
    message: 'Enable voice messages?',
    initialValue: false,
  });
  handleCancel(enableVoice);

  if (enableVoice) {
    const sttProvider = await p.select({
      message: 'Speech-to-text provider',
      options: [
        {
          value: 'whisper',
          label: 'OpenAI Whisper',
          hint: 'Cloud API, requires an OpenAI key',
        },
        { value: '__skip__', label: 'Skip', hint: 'configure later' },
      ],
    });
    handleCancel(sttProvider);

    if (sttProvider === 'whisper') {
      const configured = await configureWhisperStt(client, moxxyHome);
      if (configured) {
        p.log.success('Voice messages enabled (OpenAI Whisper).');
      } else {
        p.log.warn('Voice setup skipped. Retry later with: moxxy init');
      }
    }
  }

  p.outro('Setup complete. Run moxxy to see available commands.');
}

// ---------------------------------------------------------------------------
// Speech-to-text (voice message) helpers
// ---------------------------------------------------------------------------

const STT_WHISPER_BACKEND_KEY = 'moxxy_stt_whisper';
const STT_WHISPER_KEY_NAME = 'STT_WHISPER_API_KEY';
const OPENAI_PROVIDER_BACKEND_KEY = 'moxxy_provider_openai';

/**
 * Configure Whisper STT: either reuse an existing OpenAI vault secret or
 * prompt for a new key, then persist an `stt` block to settings.yaml.
 * Returns true on success, false if the user bailed or storage failed.
 */
async function configureWhisperStt(client, moxxyHome) {
  // Look for an existing vault entry we can reuse. Prefer a secret already
  // backing the OpenAI provider install so users don't enter the same key
  // twice.
  let reuseBackendKey = null;
  try {
    const secrets = await client.listSecrets();
    const existing = (secrets || []).find(
      (s) => s.backend_key === OPENAI_PROVIDER_BACKEND_KEY,
    );
    if (existing) {
      const reuse = await p.confirm({
        message: 'Reuse your existing OpenAI API key for Whisper?',
        initialValue: true,
      });
      handleCancel(reuse);
      if (reuse) reuseBackendKey = OPENAI_PROVIDER_BACKEND_KEY;
    }
  } catch (err) {
    // Vault listing may fail if the gateway is down — fall through to prompt.
    p.log.warn(`Could not check existing vault secrets: ${err.message}`);
  }

  let secretRef = reuseBackendKey;

  if (!secretRef) {
    const apiKey = await p.password({
      message: 'Enter your OpenAI API key (used for Whisper transcription)',
      validate: (val) => {
        if (!val || !val.trim()) return 'API key cannot be empty';
      },
    });
    handleCancel(apiKey);

    try {
      await withSpinner(
        'Storing API key in vault...',
        async () => {
          await client.createSecret({
            key_name: STT_WHISPER_KEY_NAME,
            backend_key: STT_WHISPER_BACKEND_KEY,
            policy_label: 'stt-provider',
            value: apiKey.trim(),
          });
        },
        'Whisper API key stored.',
      );
      secretRef = STT_WHISPER_BACKEND_KEY;
    } catch (err) {
      p.log.error(`Failed to store API key: ${err.message}`);
      return false;
    }
  }

  try {
    saveSttSetting(moxxyHome, {
      provider: 'whisper',
      model: 'whisper-1',
      secret_ref: secretRef,
    });
  } catch (err) {
    p.log.error(`Failed to write settings.yaml: ${err.message}`);
    return false;
  }

  return true;
}

/**
 * Write (or clear) the `stt` block in `{moxxy_home}/settings.yaml`.
 *
 * Pass `null` to remove the block. Pass an object with at least `provider`,
 * `model`, and `secret_ref` to write a fresh block. Any prior `stt:` block
 * is removed in full — including nested indented child lines — before the
 * new block is appended, so repeated runs don't accumulate stale entries.
 */
export function saveSttSetting(moxxyHome, config) {
  const settingsFile = join(moxxyHome, 'settings.yaml');

  let existing = '';
  try {
    existing = readFileSync(settingsFile, 'utf-8');
  } catch { /* no existing settings */ }

  // Strip any previous `stt:` block. A block is the `stt:` line plus all
  // subsequent indented (leading whitespace) lines — standard flow YAML.
  const kept = [];
  let inSttBlock = false;
  for (const line of existing.split('\n')) {
    if (inSttBlock) {
      if (/^\s+\S/.test(line) || line.trim() === '') {
        // indented child or blank line: still inside the block
        if (line.trim() === '') {
          inSttBlock = false;
          kept.push(line);
        }
        continue;
      }
      inSttBlock = false;
    }
    if (/^stt:\s*$/.test(line) || /^stt:\s/.test(line)) {
      inSttBlock = true;
      continue;
    }
    kept.push(line);
  }

  // Drop trailing empty lines so we can cleanly append.
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

  if (config) {
    kept.push('stt:');
    kept.push(`  provider: ${config.provider}`);
    kept.push(`  model: ${config.model}`);
    kept.push(`  secret_ref: ${config.secret_ref}`);
    if (config.api_base) kept.push(`  api_base: ${config.api_base}`);
  }

  mkdirSync(moxxyHome, { recursive: true });
  writeFileSync(settingsFile, kept.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Browser rendering helpers
// ---------------------------------------------------------------------------

function detectChromeBinary(moxxyHome) {
  const os = platform();

  // 1. CHROME_PATH env var
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  // 2. System Chrome
  const systemPaths = os === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];

  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }

  // 3. which fallback (Linux)
  if (os === 'linux') {
    for (const name of ['google-chrome', 'chromium-browser', 'chromium']) {
      try {
        const result = execSync(`which ${name}`, { stdio: 'pipe', encoding: 'utf-8' }).trim();
        if (result && existsSync(result)) return result;
      } catch { /* not found */ }
    }
  }

  // 4. Previously downloaded
  const platDir = chromePlatformDir();
  const binaryName = os === 'darwin'
    ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    : 'chrome';
  const downloaded = join(moxxyHome, 'chromium', platDir, binaryName);
  if (existsSync(downloaded)) return downloaded;

  return null;
}

function chromePlatformDir() {
  const os = platform();
  const cpuArch = arch();
  if (os === 'darwin') {
    return cpuArch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64';
  }
  return 'chrome-linux64';
}

async function installChromium(moxxyHome) {
  const CHROME_FOR_TESTING_API = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

  try {
    // Fetch latest stable version info
    const versionInfo = await withSpinner('Fetching Chromium version info...', async () => {
      const resp = await fetch(CHROME_FOR_TESTING_API, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    }, 'Version info retrieved.');

    const platKey = chromePlatformKey();
    const stable = versionInfo.channels.Stable;
    const chromeDownloads = stable.downloads.chrome;
    const entry = chromeDownloads.find(d => d.platform === platKey);

    if (!entry) {
      p.log.error(`No Chromium build for platform: ${platKey}`);
      return false;
    }

    const downloadUrl = entry.url;
    const targetDir = join(moxxyHome, 'chromium');
    mkdirSync(targetDir, { recursive: true });

    const zipPath = join(targetDir, 'chrome.zip');

    // Download
    await withSpinner(`Downloading Chromium ${stable.version}...`, async () => {
      const resp = await fetch(downloadUrl, { signal: AbortSignal.timeout(300000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const fileStream = createWriteStream(zipPath);
      await pipeline(resp.body, fileStream);
    }, 'Download complete.');

    // Extract
    await withSpinner('Extracting Chromium...', async () => {
      execSync(`unzip -o -q "${zipPath}" -d "${targetDir}"`, { stdio: 'pipe' });
    }, 'Extraction complete.');

    // Cleanup zip
    try { const { unlinkSync } = await import('node:fs'); unlinkSync(zipPath); } catch { /* ignore */ }

    const chromePath = detectChromeBinary(moxxyHome);
    if (chromePath) {
      // Make executable on Linux
      if (platform() === 'linux') {
        try { chmodSync(chromePath, 0o755); } catch { /* ignore */ }
      }
      p.log.success(`Chromium installed: ${chromePath}`);
      return true;
    }

    p.log.error('Extraction succeeded but Chrome binary not found');
    return false;
  } catch (err) {
    p.log.error(`Failed to install Chromium: ${err.message}`);
    return false;
  }
}

function chromePlatformKey() {
  const os = platform();
  const cpuArch = arch();
  if (os === 'darwin') {
    return cpuArch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  }
  return 'linux64';
}

function saveBrowserRenderingSetting(moxxyHome, enabled) {
  const settingsFile = join(moxxyHome, 'settings.yaml');
  let lines = [];
  try {
    const raw = readFileSync(settingsFile, 'utf-8');
    lines = raw.split('\n').filter(l => !l.startsWith('browser_rendering:'));
  } catch { /* no existing settings */ }

  lines.push(`browser_rendering: ${enabled}`);

  mkdirSync(moxxyHome, { recursive: true });
  writeFileSync(settingsFile, lines.filter(l => l.trim()).join('\n') + '\n');
}
