export default {
  id: 'anthropic',
  display_name: 'Anthropic',
  api_key_env: 'ANTHROPIC_API_KEY',
  api_base: 'https://api.anthropic.com',
  api_key_login: true,
  oauth_login: true,
  models: [
    { model_id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6' },
    { model_id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
    { model_id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
    { model_id: 'claude-opus-4-5-20251101', display_name: 'Claude Opus 4.5' },
    { model_id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
    { model_id: 'claude-opus-4-1-20250805', display_name: 'Claude Opus 4.1' },
    { model_id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
    { model_id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4' },
  ],
};
