# @moxxy/agent

## 0.2.11

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [497e9a1]
- Updated dependencies [bddaa83]
- Updated dependencies [e3491a9]
- Updated dependencies [5c1c334]
- Updated dependencies [238e434]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/core@0.7.0
  - @moxxy/mode-default@0.1.8
  - @moxxy/plugin-provider-anthropic@0.2.8
  - @moxxy/plugin-provider-openai@0.1.8

## 0.2.10

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/core@0.6.3
  - @moxxy/mode-default@0.1.7
  - @moxxy/plugin-provider-anthropic@0.2.7
  - @moxxy/plugin-provider-openai@0.1.7

## 0.2.9

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/core@0.6.2
  - @moxxy/mode-default@0.1.6
  - @moxxy/plugin-provider-anthropic@0.2.6
  - @moxxy/plugin-provider-openai@0.1.6

## 0.2.8

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/core@0.6.1
  - @moxxy/mode-default@0.1.5
  - @moxxy/plugin-provider-anthropic@0.2.5
  - @moxxy/plugin-provider-openai@0.1.5

## 0.2.7

### Patch Changes

- Updated dependencies [3862cb2]
  - @moxxy/core@0.6.0
  - @moxxy/mode-default@0.1.4
  - @moxxy/plugin-provider-anthropic@0.2.4

## 0.2.6

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/core@0.5.4
  - @moxxy/mode-default@0.1.4
  - @moxxy/plugin-provider-anthropic@0.2.4
  - @moxxy/plugin-provider-openai@0.1.4

## 0.2.5

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/core@0.5.3
  - @moxxy/mode-default@0.1.3
  - @moxxy/plugin-provider-anthropic@0.2.3
  - @moxxy/plugin-provider-openai@0.1.3

## 0.2.4

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/core@0.5.2
  - @moxxy/mode-default@0.1.2
  - @moxxy/plugin-provider-anthropic@0.2.2
  - @moxxy/plugin-provider-openai@0.1.2

## 0.2.3

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/core@0.5.1
  - @moxxy/mode-default@0.1.1
  - @moxxy/plugin-provider-anthropic@0.2.1
  - @moxxy/plugin-provider-openai@0.1.1

## 0.2.2

### Patch Changes

- Updated dependencies [4bdd6f8]
  - @moxxy/core@0.5.0
  - @moxxy/mode-default@0.1.0
  - @moxxy/plugin-provider-anthropic@0.2.0

## 0.2.1

### Patch Changes

- Updated dependencies [0870222]
  - @moxxy/core@0.4.0
  - @moxxy/mode-default@0.1.0
  - @moxxy/plugin-provider-anthropic@0.2.0

## 0.2.0

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

### Patch Changes

- Updated dependencies [6c48c28]
  - @moxxy/core@0.3.0
  - @moxxy/mode-default@0.1.0
  - @moxxy/plugin-provider-openai@0.1.0
  - @moxxy/plugin-provider-anthropic@0.2.0
