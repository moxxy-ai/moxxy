# @moxxy/desktop

## 0.0.4

### Patch Changes

- f3e3f1e: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/chat-model@0.0.3
  - @moxxy/desktop-host@0.0.3
  - @moxxy/desktop-ipc-contract@0.0.3
  - @moxxy/plugin-stt-whisper-codex@0.0.3
  - @moxxy/plugin-vault@0.0.3
  - @moxxy/runner@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/chat-model@0.0.2
  - @moxxy/desktop-host@0.0.2
  - @moxxy/desktop-ipc-contract@0.0.2
  - @moxxy/plugin-stt-whisper-codex@0.0.2
  - @moxxy/plugin-vault@0.0.2
  - @moxxy/runner@0.0.2
