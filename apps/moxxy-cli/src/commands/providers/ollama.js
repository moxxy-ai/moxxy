export default {
  id: 'ollama',
  display_name: 'Ollama',
  api_base: 'http://127.0.0.1:11434/v1',
  models: [
    { model_id: 'qwen3:8b', display_name: 'Qwen 3 8B' },
    { model_id: 'gemma3', display_name: 'Gemma 3' },
    { model_id: 'gpt-oss:20b', display_name: 'GPT OSS 20B' },
  ],
};
