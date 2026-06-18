---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Quality sweep: close the last deferred audit items

- **`RequirementChecker.targetInfo`** is now table-driven (`TARGET_DESCRIPTORS`
  record, byte-identical to the old per-kind switch, with compile-time
  exhaustiveness). Closes the types-generics-5 table-drive item.
- **Voice-admin** is extracted into a first-class `@moxxy/plugin-voice-admin`
  package (tools moved verbatim, registered via the cli builtin entries like the
  other plugins). Closes u28-3.
- **Reasoning-effort** is now wired end to end: the desktop Providers selector
  flows through a typed IPC command to the runner's `config.context.reasoning`
  (runner protocol bumped to v9 in lockstep with the desktop floor), instead of
  persisting to local state and silently doing nothing. Closes the long-standing
  reasoning TODO (audit c15 / R1).
