/**
 * Provider commands: install/list/verify.
 * Includes built-in provider catalog with frontier models.
 */
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, withSpinner, showResult, p } from '../ui.js';

// ── Built-in Provider Catalog ────────────────────────────────────────────────

export const BUILTIN_PROVIDERS = [
  {
    id: 'anthropic',
    display_name: 'Anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
    api_base: 'https://api.anthropic.com',
    models: [
      { model_id: 'claude-sonnet-5-20260203', display_name: 'Claude Sonnet 5 "Fennec"' },
      { model_id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4' },
      { model_id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
      { model_id: 'claude-haiku-4-20250506', display_name: 'Claude Haiku 4' },
      { model_id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
      { model_id: 'claude-3-5-haiku-20241022', display_name: 'Claude 3.5 Haiku' },
    ],
  },
  {
    id: 'openai',
    display_name: 'OpenAI',
    api_key_env: 'OPENAI_API_KEY',
    api_base: 'https://api.openai.com/v1',
    models: [
      { model_id: 'gpt-5.2', display_name: 'GPT-5.2' },
      { model_id: 'gpt-4.1', display_name: 'GPT-4.1' },
      { model_id: 'gpt-4.1-mini', display_name: 'GPT-4.1 Mini' },
      { model_id: 'gpt-4.1-nano', display_name: 'GPT-4.1 Nano' },
      { model_id: 'o3', display_name: 'o3' },
      { model_id: 'o4-mini', display_name: 'o4-mini' },
      { model_id: 'gpt-4o', display_name: 'GPT-4o' },
      { model_id: 'gpt-4o-mini', display_name: 'GPT-4o Mini' },
    ],
  },
  {
    id: 'xai',
    display_name: 'xAI',
    api_key_env: 'XAI_API_KEY',
    api_base: 'https://api.x.ai/v1',
    models: [
      { model_id: 'grok-4', display_name: 'Grok 4' },
      { model_id: 'grok-3', display_name: 'Grok 3' },
      { model_id: 'grok-3-mini', display_name: 'Grok 3 Mini' },
      { model_id: 'grok-3-fast', display_name: 'Grok 3 Fast' },
      { model_id: 'grok-2', display_name: 'Grok 2' },
    ],
  },
  {
    id: 'google',
    display_name: 'Google Gemini',
    api_key_env: 'GOOGLE_API_KEY',
    api_base: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { model_id: 'gemini-3.1-pro', display_name: 'Gemini 3.1 Pro' },
      { model_id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro' },
      { model_id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash' },
      { model_id: 'gemini-2.0-flash', display_name: 'Gemini 2.0 Flash' },
    ],
  },
  {
    id: 'deepseek',
    display_name: 'DeepSeek',
    api_key_env: 'DEEPSEEK_API_KEY',
    api_base: 'https://api.deepseek.com',
    models: [
      { model_id: 'deepseek-v4', display_name: 'DeepSeek V4' },
      { model_id: 'deepseek-r1', display_name: 'DeepSeek R1' },
      { model_id: 'deepseek-v3', display_name: 'DeepSeek V3' },
    ],
  },
  {
    id: 'zai',
    display_name: 'ZAI',
    api_key_env: 'ZAI_API_KEY',
    api_base: 'https://api.zai.com/v1',
    models: [
      { model_id: 'zai-pro', display_name: 'ZAI Pro' },
      { model_id: 'zai-standard', display_name: 'ZAI Standard' },
      { model_id: 'zai-fast', display_name: 'ZAI Fast' },
    ],
  },
  {
    id: 'zai-plan',
    display_name: 'ZAI Plan',
    api_key_env: 'ZAI_API_KEY',
    api_base: 'https://api.zai.com/v1',
    models: [
      { model_id: 'zai-plan-pro', display_name: 'ZAI Plan Pro' },
      { model_id: 'zai-plan-standard', display_name: 'ZAI Plan Standard' },
    ],
  },
];

// ── CLI Command ──────────────────────────────────────────────────────────────

export async function runProvider(client, args) {
  let [action, ...rest] = args;
  const flags = parseFlags(rest);

  // Interactive sub-menu when no action
  if (!action && isInteractive()) {
    action = await p.select({
      message: 'Provider action',
      options: [
        { value: 'install', label: 'Install provider', hint: 'add a built-in or custom provider' },
        { value: 'list',    label: 'List providers',    hint: 'show installed providers' },
      ],
    });
    handleCancel(action);
  }

  switch (action) {
    case 'list': {
      let result;
      if (isInteractive()) {
        result = await withSpinner('Fetching providers...', () =>
          client.listProviders(), 'Providers loaded.');
        if (Array.isArray(result) && result.length > 0) {
          for (const pr of result) {
            const status = pr.enabled ? 'enabled' : 'disabled';
            p.log.info(`${pr.display_name || pr.id}  (${pr.id})  [${status}]`);
          }
        } else {
          p.log.warn('No providers installed. Run: moxxy provider install');
        }
      } else {
        result = await client.listProviders();
        console.log(JSON.stringify(result, null, 2));
      }
      return result;
    }

    case 'install': {
      if (isInteractive()) {
        return await installInteractive(client);
      }
      return await installNonInteractive(client, flags);
    }

    default:
      if (!action) {
        console.error('Usage: moxxy provider <install|list>');
      } else {
        console.error(`Unknown provider action: ${action}`);
      }
      process.exitCode = 1;
  }
}

// ── Interactive Install Wizard ───────────────────────────────────────────────

async function installInteractive(client) {
  p.intro('Install Provider');

  // Step 1: Choose built-in or custom
  const providerChoice = await p.select({
    message: 'Select a provider to install',
    options: [
      ...BUILTIN_PROVIDERS.map(bp => ({
        value: bp.id,
        label: bp.display_name,
        hint: `${bp.models.length} models`,
      })),
      { value: '__custom__', label: 'Custom provider', hint: 'OpenAI-compatible endpoint' },
    ],
  });
  handleCancel(providerChoice);

  let providerId, displayName, models, apiKeyEnv, apiBase;

  if (providerChoice === '__custom__') {
    // Custom provider flow
    providerId = handleCancel(await p.text({
      message: 'Provider ID',
      placeholder: 'my-provider',
      validate: (v) => { if (!v.trim()) return 'Required'; },
    }));

    displayName = handleCancel(await p.text({
      message: 'Display name',
      placeholder: 'My Provider',
      validate: (v) => { if (!v.trim()) return 'Required'; },
    }));

    apiBase = handleCancel(await p.text({
      message: 'API base URL',
      placeholder: 'https://api.example.com/v1',
      validate: (v) => {
        try { new URL(v); } catch { return 'Must be a valid URL'; }
      },
    }));

    apiKeyEnv = handleCancel(await p.text({
      message: 'API key environment variable name',
      placeholder: 'MY_PROVIDER_API_KEY',
      validate: (v) => { if (!v.trim()) return 'Required'; },
    }));

    // Custom models
    models = [];
    let addMore = true;
    while (addMore) {
      const modelId = handleCancel(await p.text({
        message: 'Model ID',
        placeholder: 'model-name',
        validate: (v) => { if (!v.trim()) return 'Required'; },
      }));

      const modelName = handleCancel(await p.text({
        message: 'Model display name',
        initialValue: modelId,
      }));

      models.push({
        model_id: modelId,
        display_name: modelName || modelId,
        metadata: { api_base: apiBase },
      });

      addMore = handleCancel(await p.confirm({
        message: 'Add another model?',
        initialValue: false,
      }));
    }
  } else {
    // Built-in provider
    const builtin = BUILTIN_PROVIDERS.find(bp => bp.id === providerChoice);
    providerId = builtin.id;
    displayName = builtin.display_name;
    apiKeyEnv = builtin.api_key_env;
    apiBase = builtin.api_base;

    // Step 2: Select which models to install
    const CUSTOM_MODEL_VALUE = '__custom_model__';

    const selectedModels = handleCancel(await p.multiselect({
      message: 'Select models to install',
      options: [
        ...builtin.models.map(m => ({
          value: m.model_id,
          label: m.display_name,
          hint: m.model_id,
        })),
        { value: CUSTOM_MODEL_VALUE, label: 'Custom model ID', hint: 'enter a model ID manually' },
      ],
      required: true,
    }));

    models = builtin.models
      .filter(m => selectedModels.includes(m.model_id))
      .map(m => ({
        ...m,
        metadata: { api_base: apiBase },
      }));

    // Prompt for custom model details if selected
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
        metadata: { api_base: apiBase, custom: true },
      });
    }
  }

  // Step 2: API key check
  const currentKey = process.env[apiKeyEnv];
  if (currentKey) {
    const masked = currentKey.slice(0, 8) + '...' + currentKey.slice(-4);
    p.log.success(`API key found: ${apiKeyEnv} = ${masked}`);
  } else {
    p.log.warn(`API key not set: ${apiKeyEnv}`);

    const setKey = handleCancel(await p.confirm({
      message: `Store API key via vault? (You can also set ${apiKeyEnv} in your shell)`,
      initialValue: false,
    }));

    if (setKey) {
      const apiKey = handleCancel(await p.password({
        message: `Enter your ${displayName} API key`,
        validate: (v) => { if (!v.trim()) return 'Required'; },
      }));

      try {
        await withSpinner('Storing API key in vault...', async () => {
          await client.request('/v1/vault/secrets', 'POST', {
            key_name: apiKeyEnv,
            backend_key: `moxxy_provider_${providerId}`,
            policy_label: 'provider-api-key',
            value: apiKey,
          });
        }, 'API key reference stored.');

        p.note(
          `export ${apiKeyEnv}="${apiKey}"`,
          'Also add to your shell profile for direct access'
        );
      } catch (err) {
        p.log.warn(`Could not store in vault: ${err.message}`);
        p.note(
          `export ${apiKeyEnv}="<your-key>"`,
          'Set this in your shell profile'
        );
      }
    } else {
      p.note(
        `export ${apiKeyEnv}="<your-key>"`,
        'Set this in your shell profile'
      );
    }
  }

  // Step 3: Install provider via API
  const result = await withSpinner(`Installing ${displayName}...`, () =>
    client.installProvider(providerId, displayName, models),
    `${displayName} installed.`
  );

  showResult('Provider Installed', {
    ID: providerId,
    Name: displayName,
    Models: models.map(m => m.model_id).join(', '),
    'API Key Env': apiKeyEnv,
  });

  p.outro('Provider ready. Create an agent with: moxxy agent create');
  return result;
}

// ── Non-Interactive Install ──────────────────────────────────────────────────

async function installNonInteractive(client, flags) {
  const providerId = flags.id || flags.provider;

  // Check if it's a built-in provider
  const builtin = BUILTIN_PROVIDERS.find(bp => bp.id === providerId);

  if (builtin) {
    const models = builtin.models.map(m => ({
      ...m,
      metadata: { api_base: builtin.api_base },
    }));

    // Add custom model if specified
    if (flags.model) {
      models.push({
        model_id: flags.model,
        display_name: flags.model,
        metadata: { api_base: builtin.api_base, custom: true },
      });
    }

    const result = await client.installProvider(builtin.id, builtin.display_name, models);
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // Custom provider
  if (!providerId) {
    throw new Error('Required: --id (provider id). Built-in: openai, anthropic, xai, zai, zai-plan');
  }

  const displayName = flags.name || flags.display_name || providerId;
  const apiBase = flags.api_base || flags.url;
  const models = [];

  if (flags.model) {
    models.push({
      model_id: flags.model,
      display_name: flags.model_name || flags.model,
      metadata: apiBase ? { api_base: apiBase } : undefined,
    });
  }

  const result = await client.installProvider(providerId, displayName, models);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
