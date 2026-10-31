# @moxxy/reflector-default

## 0.27.32

### Patch Changes

- Updated dependencies [1e49040]
- Updated dependencies [5f83fb5]
- Updated dependencies [3879896]
- Updated dependencies [24bd7f3]
  - @moxxy/sdk@0.47.0

## 0.27.31

### Patch Changes

- Updated dependencies [546836d]
  - @moxxy/sdk@0.46.0

## 0.27.30

### Patch Changes

- 6f4d652: A new conversation no longer starts on the provider's biggest model when no default model is chosen. It starts on the provider's light starter model instead: Haiku 5.5 for Claude, GPT-6 Luna for Codex (both the agent connection and the ChatGPT sign-in). A default model chosen in Settings → Default model still comes first, and a conversation keeps the model it last ran on. Settings → Default model, the chat's effort and fast controls, a bot's "Default" model and the terminal's header now show the model that really runs, not the first one listed. The helper calls Moxxy makes by itself, outside the conversation, run on the starter model too instead of the biggest one: merging memories (`memory_consolidate`), drafting a workflow (`workflow_create`, unless the host sets a draft model) and the post-turn reflection.

  The SDK adds `LLMProvider.starterModel`, `ProviderDef.starterModel`, `ProviderInfo.starterModel` and `startingModel()`. The runner protocol goes to v30 (`ProviderInfo.starterModel`, additive); an older runner leaves it out and surfaces fall back to the first listed model.

- Updated dependencies [71f8aa8]
- Updated dependencies [db33b95]
- Updated dependencies [71e90e5]
- Updated dependencies [84ff880]
- Updated dependencies [b6c11c4]
- Updated dependencies [02119e8]
- Updated dependencies [29841af]
- Updated dependencies [211f80c]
- Updated dependencies [49dd789]
- Updated dependencies [90ab0bb]
- Updated dependencies [cb494ef]
- Updated dependencies [b6c11c4]
- Updated dependencies [887b8b7]
- Updated dependencies [072b8b5]
- Updated dependencies [a8e8418]
- Updated dependencies [322f2ce]
- Updated dependencies [7868760]
- Updated dependencies [4af5560]
- Updated dependencies [ee669b7]
- Updated dependencies [3c1527c]
- Updated dependencies [178a215]
- Updated dependencies [318d476]
- Updated dependencies [7cc93a2]
- Updated dependencies [6e54a6b]
- Updated dependencies [1329245]
- Updated dependencies [8472068]
- Updated dependencies [deeeeea]
- Updated dependencies [46b20d3]
- Updated dependencies [9bfe644]
- Updated dependencies [d2de3a1]
- Updated dependencies [7d718f6]
- Updated dependencies [6f4d652]
- Updated dependencies [d118b03]
- Updated dependencies [2160501]
- Updated dependencies [2b9c87f]
- Updated dependencies [332e4c2]
- Updated dependencies [a06de31]
- Updated dependencies [066a949]
- Updated dependencies [fa44b8c]
  - @moxxy/sdk@0.45.0

## 0.27.29

### Patch Changes

- Updated dependencies [d70839e]
  - @moxxy/sdk@0.44.0

## 0.27.28

### Patch Changes

- Updated dependencies [7b24827]
- Updated dependencies [45f501a]
- Updated dependencies [1c4d5aa]
- Updated dependencies [889810e]
- Updated dependencies [3b0fcdf]
- Updated dependencies [0a44449]
- Updated dependencies [235ae19]
- Updated dependencies [a501dbd]
  - @moxxy/sdk@0.43.0

## 0.27.27

### Patch Changes

- @moxxy/sdk@0.42.1

## 0.27.26

### Patch Changes

- Updated dependencies [1bde2f6]
- Updated dependencies [ac81f33]
- Updated dependencies [2f408fa]
- Updated dependencies [f44cf63]
- Updated dependencies [54d629a]
- Updated dependencies [ca9a67f]
- Updated dependencies [467542f]
- Updated dependencies [808bbfd]
- Updated dependencies [c329313]
- Updated dependencies [9cb28d6]
- Updated dependencies [bd8473c]
- Updated dependencies [40b40f4]
- Updated dependencies [194abc6]
- Updated dependencies [e825fa1]
- Updated dependencies [40d310e]
- Updated dependencies [5ca8fbe]
- Updated dependencies [c273722]
- Updated dependencies [5a18a15]
- Updated dependencies [97c44bd]
- Updated dependencies [8a10b7d]
- Updated dependencies [a34b1d7]
- Updated dependencies [1e5cb75]
- Updated dependencies [bf368a0]
- Updated dependencies [fe2eb5a]
- Updated dependencies [a34b1d7]
  - @moxxy/sdk@0.42.0

## 0.27.25

### Patch Changes

- Updated dependencies [6fefc59]
  - @moxxy/sdk@0.41.3

## 0.27.24

### Patch Changes

- @moxxy/sdk@0.41.2

## 0.27.23

### Patch Changes

- @moxxy/sdk@0.41.1

## 0.27.22

### Patch Changes

- Updated dependencies [9039517]
- Updated dependencies [c6ee82d]
- Updated dependencies [b01809e]
- Updated dependencies [46136ab]
- Updated dependencies [f13cda7]
- Updated dependencies [ba473d9]
  - @moxxy/sdk@0.41.0

## 0.27.21

### Patch Changes

- Updated dependencies [7e47604]
  - @moxxy/sdk@0.40.0

## 0.27.20

### Patch Changes

- Updated dependencies [1d983d9]
  - @moxxy/sdk@0.39.0

## 0.27.19

### Patch Changes

- Updated dependencies [971fd32]
  - @moxxy/sdk@0.38.0

## 0.27.18

### Patch Changes

- Updated dependencies [84dd2c5]
  - @moxxy/sdk@0.37.2

## 0.27.17

### Patch Changes

- Updated dependencies [e80b9d6]
- Updated dependencies [abd9482]
- Updated dependencies [5e4ca9f]
  - @moxxy/sdk@0.37.1

## 0.27.16

### Patch Changes

- Updated dependencies [78938f8]
  - @moxxy/sdk@0.37.0

## 0.27.15

### Patch Changes

- @moxxy/sdk@0.36.1

## 0.27.14

### Patch Changes

- Updated dependencies [bc7844e]
  - @moxxy/sdk@0.36.0

## 0.27.13

### Patch Changes

- @moxxy/sdk@0.35.4

## 0.27.12

### Patch Changes

- @moxxy/sdk@0.35.3

## 0.27.11

### Patch Changes

- @moxxy/sdk@0.35.2

## 0.27.10

### Patch Changes

- @moxxy/sdk@0.35.1

## 0.27.9

### Patch Changes

- Updated dependencies [57f0810]
  - @moxxy/sdk@0.35.0

## 0.27.8

### Patch Changes

- Updated dependencies [ae16897]
- Updated dependencies [d9ae119]
- Updated dependencies [6d8fdcd]
- Updated dependencies [220673e]
- Updated dependencies [b25850c]
- Updated dependencies [63b1df5]
- Updated dependencies [3dfc2f3]
- Updated dependencies [e52e2ed]
- Updated dependencies [e52e2ed]
- Updated dependencies [06e81f8]
  - @moxxy/sdk@0.34.0

## 0.27.7

### Patch Changes

- Updated dependencies [b241085]
  - @moxxy/sdk@0.33.0

## 0.27.6

### Patch Changes

- Updated dependencies [3b0c14a]
  - @moxxy/sdk@0.32.0

## 0.27.5

### Patch Changes

- Updated dependencies [8bb26b1]
- Updated dependencies [43926ab]
  - @moxxy/sdk@0.31.0

## 0.27.4

### Patch Changes

- Updated dependencies [c124a15]
  - @moxxy/sdk@0.30.0

## 0.27.3

### Patch Changes

- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0

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
