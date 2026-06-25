# @moxxy/plugin-provider-openai

## 0.1.8

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.1.7

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.1.6

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.1.5

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.1.4

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.1.3

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.1.2

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.1.1

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.1.0

### Minor Changes

- 6c48c28: feat: publish the programmatic moxxy runtime + a one-call agent API

  Make the embeddable moxxy API public on npm so developers can build agents in
  their own code (alongside the already-public `@moxxy/sdk`):

  - **`@moxxy/core`** — the engine: `Session` + `runTurn`/`collectTurn`, the block
    registries, the plugin host, persistence, the permission engine. Now also
    ships **`setupAgent(...)`** — a one-call, synchronous, destructurable factory
    (`const { ask, stream, session } = setupAgent({ plugins, provider, tools })`)
    with `ask` (async final text), `stream` (async generator of events),
    `collect`, and chainable hot-swap sugar (`setProvider`/`setMode`/`addTool`/…).
    It accepts a single options object, a preset, or an **array of presets** that
    merge (shared plugins de-duped, first provider active). The `@moxxy/sdk` types
    in the surface are re-exported, so it's fully typed from one import.
  - **`@moxxy/agent`** — batteries-included: bundles core + the default loop + the
    OpenAI and Anthropic providers behind drop-in presets.
    `setupAgent(openaiPreset({ apiKey }))` is a complete, runnable agent in one
    install + one call.
  - **`@moxxy/mode-default`**, **`@moxxy/plugin-provider-openai`**,
    **`@moxxy/plugin-provider-anthropic`** — the minimal runnable block set.

  Every package ships a production-ready README with examples. Blocks stay
  swappable — nothing is built into core; publishing these changes no runtime
  behaviour of the CLI or desktop (which still bundle them internally).

## 0.0.23

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.0.22

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.0.21

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.0.20

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.0.19

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.0.18

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.0.17

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.0.16

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.0.15

### Patch Changes

- 951f374: Make the model's reasoning visible, and redesign sub-agents as a collapsible group.

  **Reasoning preview (per-provider, Codex-style between calls).** When enabled, the model's
  thinking now streams live (replacing the silent "thinking…" dots) and is kept as a dim,
  collapsible "Thinking" block interleaved with the tool calls it precedes — so you can see what
  the model is doing instead of waiting out a multi-second pause. Because reasoning is finalized
  once per provider round, summaries land naturally between tool batches.

  It's gated per provider/model via a new `ModelDescriptor.supportsReasoning` capability and turned
  on with `config.context.reasoning` (`true`, or `{ effort: 'low' | 'medium' | 'high' }`):

  - **Anthropic / Claude Code** — adaptive thinking with summarized display; the signed thinking
    block round-trips so interleaved-thinking tool-use continuations stay valid.
  - **OpenAI Codex** — surfaces the reasoning summary it already requests (previously discarded).
  - **OpenAI** — `reasoning_effort` for the gpt-5 family plus the `reasoning_content` summary that
    OpenAI-compatible reasoning backends stream.

  New SDK surface: a `reasoning` `ContentBlock`, `reasoning_delta`/`reasoning_signature`
  `ProviderEvent`s, `reasoning_chunk`/`reasoning_message` events, a `ProviderRequest.reasoning`
  knob, and `ModelDescriptor.supportsReasoning`. No runner protocol bump — reasoning events ride
  the existing event channel.

  **Grouped sub-agents view.** A `dispatch_agent` fan-out now renders as one collapsible group —
  a header (`N Explore agents finished`) over a tree of per-agent rows showing each agent's tool-use
  count, **token usage**, and status — instead of one block per child. Per-agent token totals and the
  agent kind are forwarded on the `subagent_*` events; both the desktop and TUI render the new tree.

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

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

## 0.0.10

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
