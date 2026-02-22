# manage_providers

Use this skill to manage LLM providers. You can list available providers, add custom providers (e.g. local Ollama, LM Studio, vLLM, or any OpenAI-compatible endpoint), remove custom providers, or switch the active provider and model.

### Usage
- `manage_providers list` - Lists all available providers (built-in + custom).
- `manage_providers list_custom` - Lists only custom (user-added) providers.
- `manage_providers add <id> <name> <base_url> [api_format] [vault_key] [default_model] [models_json]` - Add a custom provider.
- `manage_providers remove <provider_id>` - Remove a custom provider.
- `manage_providers switch <provider_id> <model_id>` - Switch the active LLM provider and model for this agent.

### Examples

**Add a local Ollama provider:**
```
manage_providers add ollama "Ollama (Local)" http://localhost:11434/v1/chat/completions openai ollama_api_key llama3.3:70b '[{"id":"llama3.3:70b","name":"Llama 3.3 70B"},{"id":"qwen3:32b","name":"Qwen 3 32B"}]'
```

**Add a custom OpenAI-compatible provider:**
```
manage_providers add together "Together AI" https://api.together.xyz/v1/chat/completions openai together_api_key meta-llama/Llama-3.3-70B-Instruct-Turbo '[{"id":"meta-llama/Llama-3.3-70B-Instruct-Turbo","name":"Llama 3.3 70B Turbo"}]'
```

**Switch to a provider:**
```
manage_providers switch openrouter anthropic/claude-sonnet-4.6
```

### Notes
- After adding a provider, you need to store the API key using `manage_vault set <vault_key> <api_key>` and restart the agent.
- For local providers that don't require authentication, set any placeholder as the vault key and store a dummy value.
- The `api_format` can be `openai` (most common), `gemini`, or `anthropic`.
- When adding a provider, the `models_json` argument is a JSON array of `{"id": "...", "name": "..."}` objects.
