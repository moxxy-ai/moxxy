---
name: add-a-provider
description: Implement an LLMProvider plugin for a new model API — use when adding support for a new LLM vendor or auth scheme.
---

# Add a provider

Full workflow: **`.claude/agents/provider-author.md`**. Repo-specific contract
points (each one was an audit finding — don't re-break them):

- `defineProvider(spec)` with `createClient`; register via
  `definePlugin({ providers: [...] })` + `packages/cli/src/setup/builtins.ts`.
- **Compose SDK helpers**: `collectProviderStream`, `isRetryableError`,
  `classifyHttpStatus` (map HTTP status → typed MoxxyError), `zodToJsonSchema`
  for tool specs. Don't reimplement.
- **`req.system` is ADDITIVE** (A38): deliver it in addition to system-role
  messages (anthropic: extra uncached system block after the cache breakpoint;
  openai: extra system message; codex: appended to `instructions`). Silently
  dropping it kills hook-injected nudges.
- **Honor `req.maxTokens` / `req.temperature`** or document-and-warn why not
  (A36) — never a silent drop.
- **Express `CacheHint`s** from the active CacheStrategy (anthropic →
  `cache_control`). Keep expression deterministic.
- **Model descriptors matter**: an unlisted model id must not silently fall
  back to `models[0]` semantics (broke auto-elision once, PR #101). Report a
  real model catalog + vendor slug for usage attribution (A37).
- **Key resolution**: config.apiKey → vault → `<PROVIDER>_API_KEY` env →
  prompt. OAuth/rotating tokens: serialize refresh+persist with
  `withCredentialLock` from plugin-oauth (A18) — single-use refresh tokens
  corrupt without it.
- Retry transient 5xx on token endpoints (Anthropic OAuth 500s, PR #99).

Runtime alternative: an OpenAI-compatible vendor needs NO code — the
`provider_add` tool / add-provider skill registers it into
`~/.moxxy/providers.json`.

Test with `@moxxy/testing` record/replay (`MOXXY_FIXTURES=record` once, commit
fixtures). Reference impls: `plugin-provider-anthropic` (API key + cache),
`plugin-provider-claude-code` (OAuth bearer), `plugin-provider-openai-codex`
(Responses API).
