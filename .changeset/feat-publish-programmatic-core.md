---
"@moxxy/core": minor
"@moxxy/agent": minor
"@moxxy/mode-default": minor
"@moxxy/plugin-provider-openai": minor
"@moxxy/plugin-provider-anthropic": minor
---

feat: publish the programmatic moxxy runtime + a one-call agent API

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
