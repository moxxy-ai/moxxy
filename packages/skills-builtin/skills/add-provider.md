---
name: add-provider
description: Register a new LLM provider (z.ai, deepseek, groq, openrouter, fireworks, together, mistral, perplexity, …) with moxxy and configure its API key so the user can switch to it.
triggers:
  - add provider
  - new provider
  - install provider
  - register provider
  - add z.ai
  - add deepseek
  - add groq
  - add openrouter
  - add fireworks
  - add together
  - add mistral
  - add perplexity
allowed-tools:
  - provider_add
  - provider_list
  - provider_remove
  - provider_test
  - vault_set
  - vault_status
---

The user wants to add a new LLM provider to moxxy so they can switch to it later (`/provider <name>` or via `provider.name` in moxxy.config.ts). Walk them through these steps; be terse and pause for confirmation between gather → register → key.

## Scope

This skill only handles **OpenAI-compatible** vendors — i.e. those that expose a Chat Completions endpoint shaped like OpenAI's (`/v1/chat/completions`, tool-call format, streaming with `data:` chunks). That covers the vast majority of modern API vendors: z.ai (GLM), deepseek, groq, openrouter, fireworks, together, mistral, perplexity, anyscale, deepinfra, octoai, and many more.

If the vendor speaks a different protocol (Anthropic-style, Google Vertex, custom), tell the user this skill can't handle it and direct them to author a full provider plugin (see `.claude/agents/provider-author.md`).

## 1. Gather the basics

Ask the user, or infer from their request:

- **Provider slug** — short lowercase identifier (e.g. `zai`, `deepseek`, `groq`, `openrouter`). This becomes the registry key, the canonical vault entry name (`<SLUG>_API_KEY`), and what the user types in `/provider <slug>`. Must match `[a-z][a-z0-9-]*`.
- **API base URL** — the vendor's OpenAI-compatible endpoint root. Examples:
  - z.ai → `https://api.z.ai/api/coding/paas/v4`
  - deepseek → `https://api.deepseek.com`
  - groq → `https://api.groq.com/openai/v1`
  - openrouter → `https://openrouter.ai/api/v1`
  - fireworks → `https://api.fireworks.ai/inference/v1`
  - together → `https://api.together.xyz/v1`
  - mistral → `https://api.mistral.ai/v1`
- **Default model id** — the model to use when no other is specified (you'll usually pick the vendor's "flagship" or "best general purpose" model).

If the user hasn't given you the baseURL, look it up via WebFetch on the vendor's docs (search for "openai compatible", "base url", "endpoint") and propose it back to them for confirmation. **Do not guess.**

## 2. Discover the model list

You need to populate a `models` array. Each entry needs `id`, `contextWindow`, `maxOutputTokens?`, `supportsTools`, `supportsStreaming`, `supportsImages?`, `supportsAudio?`.

Two paths, in order of preference:

1. **WebFetch the vendor's models / pricing page** to extract the current catalog. Good search prompts: `"<vendor> models pricing context window"`, `"<vendor> api models list"`. Common locations:
   - z.ai → `https://docs.z.ai/guides/llm/glm-4.6`, `https://z.ai/pricing`
   - deepseek → `https://api-docs.deepseek.com/quick_start/pricing`
   - groq → `https://console.groq.com/docs/models`
   - openrouter → `https://openrouter.ai/models`
   - fireworks → `https://fireworks.ai/models`
2. **Hit the vendor's `/v1/models` endpoint** after the user gives you the key. Listing is free for almost every vendor. The response is the canonical model id list but does NOT include context windows — you still need to pull those from docs.

Build the list, show it to the user as a markdown table (id / context / tools / images), and ask them to confirm or trim. **Do not invent context-window numbers.** If a model's context is unknown, ask the user or leave it out.

Tool-call support and streaming default to `true` for OpenAI-compatible vendors (their /v1/chat/completions endpoint inherits both). Only flip them to `false` if you've confirmed the vendor doesn't.

## 3. Test the endpoint (optional, but recommended)

Before persisting, ask the user for their API key and call `provider_test` with `baseURL` + `apiKey`. This hits `/v1/models`:

- `{ ok: true }` → green light, proceed.
- `{ ok: false, message: "..." }` → relay the vendor error verbatim. Common causes: wrong baseURL, wrong key, vendor doesn't expose `/v1/models`. For the last case, you can skip the test and proceed at the user's risk.

## 4. Store the API key in the vault

Call `vault_set` with:
- `name`: `<SLUG>_API_KEY` (uppercase) — e.g. `ZAI_API_KEY`, `DEEPSEEK_API_KEY`. This matches moxxy's canonical resolution path (config.apiKey → vault → env → prompt).
- `value`: the key the user gave you.
- `tags`: `["provider", "<slug>"]` so the user can identify it later in `vault_list`.

If the user pasted the key inline before this step, store it FIRST so it doesn't linger in transcript scrollback as plaintext. Never repeat the key back to them.

## 5. Register the provider

Call `provider_add` with the gathered fields:

```json
{
  "kind": "openai-compat",
  "name": "<slug>",
  "baseURL": "<base url>",
  "defaultModel": "<id>",
  "models": [
    { "id": "<id>", "contextWindow": 200000, "supportsTools": true, "supportsStreaming": true }
  ]
}
```

`provider_add` does two things atomically:
1. Registers the provider in the LIVE session — switchable immediately.
2. Persists to `~/.moxxy/providers.json` so it survives restarts.

If `provider_add` returns `{ replaced: true }`, mention that to the user — it means a provider with the same slug already existed and they just overwrote it.

## 6. Help them switch to it (optional)

Ask if they want this provider as the default:

- **Just this session** → suggest `/provider <slug>` (typed in the TUI). Don't do it for them unless asked.
- **Permanently** → offer to edit `moxxy.config.ts` and set `provider.name` (and optionally `provider.model`) to the new values. Use the Edit tool. Mention they can run `moxxy doctor` afterward to confirm the key resolves.

## 7. Summarize

Report:
- Provider slug + baseURL + default model.
- That the API key is in the vault under `<SLUG>_API_KEY`.
- That `~/.moxxy/providers.json` was updated and the provider is live this session.
- How to switch to it.

## Don't

- Don't invent baseURLs, model ids, or context windows. If you're not sure, WebFetch or ask.
- Don't store the API key anywhere except the vault. Never write it into a file in the repo, never echo it back.
- Don't try to handle non-OpenAI-compatible vendors here — those need a real provider plugin (`.claude/agents/provider-author.md`).
- Don't overwrite an existing provider slug without telling the user first. Call `provider_list` if you're unsure whether the slug is taken.
- Don't auto-edit `moxxy.config.ts` to switch the default without asking. The user may want to keep their current provider as primary.
