# @moxxy/reflector-default

## 0.27.2

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1

## 0.27.1

### Patch Changes

- 3bf5b52: feat(memory): persistent user model — always-injected `~/.moxxy/memory/user-model.md` + update tool

  A first-class user model (Identity / Preferences / Workflows / Context) is now
  ALWAYS injected into the system prompt as a delimited `<user-model>` block
  (capped at 4000 chars, idempotent per request, error-swallowing). It is updated
  only through the deliberate, permission-prompted `memory_update_user_model` tool
  — never silently written by the loop. The default reflector now steers durable
  user-trait proposals toward this tool, and `moxxy memory user-model` prints the
  current file.

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0

## 0.27.0

### Minor Changes

- 2cef8e1: feat(reflector): swappable `reflector` registry category + `@moxxy/reflector-default` learning loop.

  A new single-active registry category — the learning-loop block that watches a finished turn and _proposes_ memory/skill improvements without ever writing silently. Mirrors the `eventStore` category across all 7 layers (config `plugins.reflector.default`, SDK `ReflectorDef`/`ReflectContext`/`ReflectionProposal` contract + plugin slot, core `ReflectorRegistry`, host registry-kind wiring, session field + `services('reflectors')`, CLI apply/category-swap, catalog), but NULLABLE: core seeds no floor, so reflection is opt-in (like transcriber/synthesizer).

  `@moxxy/reflector-default` (discovery-loaded) ships the default `ReflectorDef` `'default'` AND the driver in one plugin. The driver's `onTurnEnd` runs a cheap gate (≥5 tool results OR ≥1 error OR ≥8 mode iterations) under a one-reflection-per-session budget, then fires the reflection FIRE-AND-FORGET so it never blocks or throws into the turn. The reflector does one cheap side-channel LLM pass over a turn digest and returns 0-2 proposals; those are delivered as a ONE-TIME nudge on the next `onBeforeProviderCall`, phrased so the model MAY call `memory_save` / `synthesize_skill` — which still hit their own permission prompts. No silent writes. Graceful no-provider / provider-error skips; `memory_save` and `synthesize_skill` are declared as optional requirements. User-model injection of proposals is deferred to a follow-up PR.

### Patch Changes

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
