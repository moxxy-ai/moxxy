---
"@moxxy/sdk": patch
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Quality sweep, wave 6 (god-file decomposition — atomic modules)

Behavior-preserving structural refactor: the largest god-files are split into
focused, single-responsibility sibling modules and re-exported from their
original paths, so every existing import and the public API are byte-identical
(verified by typecheck + check:deps + the existing test suites).

- runner: `RemoteSession` (1145→789 LOC) → per-surface `client-views/*`;
  `RunnerServer` (781→509 LOC) → per-domain `handlers/*`. Wire protocol unchanged.
- `@moxxy/sdk`: `mode-helpers.ts` (797 LOC) → `mode/{project-messages,collect-stream,single-shot,stuck-loop,stable-hash}.ts`, barrel exports byte-identical.
- plugin-workflows DAG executor, plugin-webhooks tools, plugin-self-update
  core-tools split into per-concern/per-tool modules.
- desktop: electron `main/index.ts`, `WorkflowCanvas.tsx` (→ `canvas-graph` +
  camera/drag hooks), `Composer.tsx` decomposed; pure helpers now unit-tested.
- `desktop-ipc-contract` barrel split into per-domain files (re-exported).
- cli `setup/builtins.ts` + `setup/workflows.ts` decomposed into composables.
- core `PluginHost` registration/unregistration is now driven by one
  `REGISTRY_KINDS` table (was 2 parallel hardcoded 16-entry lists); shared
  `PluginHostOptions` extracted to a leaf to keep the host/table dependency
  one-directional (no import cycle).

Cross-package moves (e.g. relocating voice tools to a new package) were
deferred — they change package boundaries and belong in their own PRs.
