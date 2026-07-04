# @moxxy/plugin-provider-admin

## 0.27.0

### Minor Changes

- e5ea7e6: The LAST config store outside the unified tree is gone: runtime-registered
  (OpenAI-compatible) vendors now persist at `plugins.provider.items.<name>`
  in `~/.moxxy/config.yaml` (`config` carries the vendor payload, `model` the
  default) instead of `~/.moxxy/providers.json`. The provider-admin API is
  unchanged — the tools, the runner's `provider.configure`, and the desktop
  settings sheet all moved with it; the desktop reads the tree directly (yaml
  parse, no @moxxy/config in the Electron main). `provider_remove` refuses to
  touch a built-in provider's item (picker-written model/enabled prefs
  survive). Clean-slate per repo convention: re-add custom vendors via
  `provider_add` or the desktop sheet — no migration shim.
- 502acf0: Slim wave, final batches: the whisper STT pair, the Telegram + Slack
  channels, provider-admin and mcp move out of the CLI binary — all seeded
  into the desktop (voice, Settings panels and Apps→Channels keep working
  offline) and installable on demand everywhere else. `moxxy telegram` /
  `moxxy channels start slack` on a slim install print the exact install
  command instead of "unknown command". `@moxxy/config` flips public as the
  channels' dependency closure. The kernel is now the plan's target set: the
  TUI, built-in tools, default mode, context floors, vault, plugins-admin,
  commands, memory, the two OAuth providers, and the dormant daemons.

### Patch Changes

- 87aac6d: Declare honest `isolation` capability specs on the remaining admin and long-tail plugin tools (36 tools across 13 packages), completing the backfill that lets `security.requireDeclaration` be enabled.
- Updated dependencies [87aac6d]
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [e5ea7e6]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [502acf0]
- Updated dependencies [be28d55]
  - @moxxy/config@0.27.0
  - @moxxy/sdk@0.27.0
  - @moxxy/plugin-provider-openai@0.27.0

## 0.26.0

### Minor Changes

- 386e526: Slim wave, batch 2: `@moxxy/plugin-view`, `@moxxy/plugin-self-update` and
  `@moxxy/plugin-voice-admin` (plugin renamed from `@moxxy/voice-admin` to
  match its package) move out of the CLI binary and install on demand.
  `@moxxy/plugin-provider-admin` + `@moxxy/plugin-mcp` (entry alias
  `@moxxy/plugin-mcp-admin` dropped — the plugin now registers under its
  package name) flip publishable as prep but stay bundled until the desktop
  seed pack lands: the desktop Settings panels reach them through the
  `providerAdmin`/`mcpAdmin` session services on the spawned runner.
  self-update's staged-update finalizer stays inlined in the binary (bin.ts
  imports it statically); only the registered plugin instance moves out.

### Patch Changes

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0
  - @moxxy/plugin-provider-openai@0.26.0

## 0.25.0

### Patch Changes

- @moxxy/sdk@0.25.0
- @moxxy/plugin-provider-openai@0.25.0

## 0.24.1

### Patch Changes

- @moxxy/sdk@0.24.1
- @moxxy/plugin-provider-openai@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/plugin-provider-openai@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/plugin-provider-openai@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/plugin-provider-openai@0.22.0

## 0.21.1

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/plugin-provider-openai@0.21.1

## 0.21.0

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/plugin-provider-openai@0.21.0

## 0.1.18

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/plugin-provider-openai@0.1.8

## 0.1.17

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/plugin-provider-openai@0.1.7

## 0.1.16

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/plugin-provider-openai@0.1.6

## 0.1.15

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/plugin-provider-openai@0.1.5

## 0.1.14

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/plugin-provider-openai@0.1.4

## 0.1.13

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/plugin-provider-openai@0.1.3

## 0.1.12

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/plugin-provider-openai@0.1.2

## 0.1.11

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/plugin-provider-openai@0.1.1

## 0.1.10

### Patch Changes

- Updated dependencies [6c48c28]
  - @moxxy/plugin-provider-openai@0.1.0

## 0.1.9

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/plugin-provider-openai@0.0.23

## 0.1.8

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/plugin-provider-openai@0.0.22

## 0.1.7

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4
  - @moxxy/plugin-provider-openai@0.0.21

## 0.1.6

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/plugin-provider-openai@0.0.20

## 0.1.5

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/plugin-provider-openai@0.0.19

## 0.1.4

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1
  - @moxxy/plugin-provider-openai@0.0.18

## 0.1.3

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/plugin-provider-openai@0.0.17

## 0.1.2

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/plugin-provider-openai@0.0.16

## 0.1.1

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/plugin-provider-openai@0.0.15

## 0.1.0

### Minor Changes

- aacdf1d: Desktop: live registry refresh + interactive provider management.

  The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

  Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/plugin-provider-openai@0.0.14

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0
  - @moxxy/plugin-provider-openai@0.0.13

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/plugin-provider-openai@0.0.12

## 0.0.11

### Patch Changes

- cf2f651: Provider-parity fixes from the 2026-06-09 audit (A36–A38):

  - **Codex (A36):** `req.maxTokens` now reaches the Responses API as `max_output_tokens`; `req.temperature` is documented-unsupported on the Codex backend (gpt-5 reasoning models reject sampling params) and dropped with a one-shot MOXXY_DEBUG note instead of silently; `reasoningEffort` is a live `CodexProviderConfig` option (was pinned to 'medium') and the CLI's codex credential resolver now passes `provider.config` through to the client instead of discarding it.
  - **Runtime openai-compat providers (A37):** registered vendors now report their own name + model catalog on the live client (usage stats / errors / context-window lookups no longer misattributed to 'openai'); vault/env key naming is unified behind `providerApiKeyName`/`storedProviderApiKeyName` in plugin-provider-admin — the CLI honors a stored `envVar` override and maps hyphens to underscores, matching the desktop; `provider_add` model descriptors can declare `supportsDocuments` so attachments stop degrading.
  - **`req.system` contract (A38):** hook-injected system text (e.g. plugin-memory's consolidation nudge) now actually reaches every provider — delivered in addition to system-role messages (anthropic: extra system block after the cache breakpoint; openai: inserted system message; codex: appended to `instructions`). The loop helpers no longer prefill `req.system` with the system prompt, which also removes a duplicated base prompt in codex `instructions`.

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/plugin-provider-openai@0.0.11

## 0.0.10

### Patch Changes

- f297da0: Security: `provider_test` no longer takes the plaintext API key as model-visible tool input. It now takes the NAME of a vault secret (`keyName`, e.g. `DEEPSEEK_API_KEY`) and resolves the key at call time via `ctx.getSecret`, so the plaintext never enters the model context, the session log, or the desktop NDJSON log. Missing-secret and no-vault cases return actionable guidance (`/vault set <NAME> <key>`); the add-provider skill and `provider_add`'s returned note were updated to route endpoint verification through the vault name.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0
  - @moxxy/plugin-provider-openai@0.0.10

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/plugin-provider-openai@0.0.9

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/plugin-provider-openai@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/plugin-provider-openai@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/plugin-provider-openai@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/plugin-provider-openai@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/plugin-provider-openai@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/plugin-provider-openai@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/plugin-provider-openai@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
  - @moxxy/plugin-provider-openai@0.0.1
