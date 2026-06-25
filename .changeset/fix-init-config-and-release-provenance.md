---
"@moxxy/cli": patch
---

fix(init): persist the setup wizard into `~/.moxxy/config.yaml` + unblock provider publishing

**`moxxy init` saved nothing usable.** The wizard wrote a legacy-shaped
`provider:`/`mode:`/`embeddings:` file into the *project cwd*, but the clean-slate
config schema only reads the unified `plugins:` tree and silently strips those
top-level keys. A freshly-`init`'d install therefore booted with no active
provider — the TUI's `No working provider credentials. Tried: .` (empty list).
init now persists the selections into `~/.moxxy/config.yaml` as
`plugins.provider.default` (+ `items.<name>.model`, `fallbacks`),
`plugins.mode.default`, `plugins.embedder.default` and `security.enabled`, via a
comment-preserving doc merge that keeps the package ledger `ensureProvider` /
`installPlugins` already wrote — the same store `moxxy provision` and the runtime
quick-switches use. Like `provision`, the API key stays in the vault under its
canonical name (no `${vault:...}` ref written).

**Release publishing.** The new `@moxxy/plugin-provider-*` packages were missing
`repository.url`, so npm provenance rejected them with E422; and `claude-code` /
`openai-codex` depended on the still-private `@moxxy/plugin-oauth` (→
`@moxxy/plugin-vault`). Added the publish metadata to all six providers and made
`@moxxy/plugin-oauth` + `@moxxy/plugin-vault` public so on-demand provider install
from npm resolves.
