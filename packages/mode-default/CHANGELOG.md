# @moxxy/mode-default

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

> Renamed from `@moxxy/mode-tool-use`. The default loop strategy; mode name `default`.

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
