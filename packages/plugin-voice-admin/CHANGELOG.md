# @moxxy/plugin-voice-admin

## 0.29.0

### Patch Changes

- ea24f82: Replace non-null assertions and depth-≥2 optional chains with explicit guards (`invariant`/`assertDefined` from `@moxxy/sdk`) across the provider, embeddings, memory, mcp, browser, view, terminal, collab, stt, and voice-admin plugins. Behavior-preserving: normal-absence paths (streaming heartbeats, optional hooks, best-effort cleanup) keep their silent skips; only impossible-by-construction absences now fail loudly at the assumption site.
- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0

## 0.27.0

### Patch Changes

- 87aac6d: Declare honest `isolation` capability specs on the remaining admin and long-tail plugin tools (36 tools across 13 packages), completing the backfill that lets `security.requireDeclaration` be enabled.
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [be28d55]
  - @moxxy/sdk@0.27.0

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

## 0.0.16

### Patch Changes

- @moxxy/sdk@0.25.0

## 0.0.15

### Patch Changes

- @moxxy/sdk@0.24.1

## 0.0.14

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.0.13

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.0.12

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.0.11

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.0.10

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.0.9

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.0.8

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.0.7

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.0.6

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.0.5

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.0.4

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

## 0.0.3

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.0.2

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.0.1

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
