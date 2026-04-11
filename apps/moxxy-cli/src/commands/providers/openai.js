export default {
  id: 'openai',
  display_name: 'OpenAI',
  api_key_env: 'OPENAI_API_KEY',
  api_base: 'https://api.openai.com/v1',
  models: [
    { model_id: 'gpt-5.4', display_name: 'GPT-5.4' },
    { model_id: 'gpt-5.4-mini', display_name: 'GPT-5.4 Mini' },
    { model_id: 'gpt-5.4-nano', display_name: 'GPT-5.4 Nano' },
    { model_id: 'gpt-5.2', display_name: 'GPT-5.2' },
    { model_id: 'gpt-4.1', display_name: 'GPT-4.1' },
    { model_id: 'gpt-4.1-mini', display_name: 'GPT-4.1 Mini' },
    { model_id: 'gpt-4.1-nano', display_name: 'GPT-4.1 Nano' },
    { model_id: 'o3', display_name: 'o3' },
    { model_id: 'o4-mini', display_name: 'o4-mini' },
    { model_id: 'gpt-4o', display_name: 'GPT-4o' },
    { model_id: 'gpt-4o-mini', display_name: 'GPT-4o Mini' },
  ],
};
