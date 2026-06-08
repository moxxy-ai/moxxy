---
"@moxxy/sdk": minor
"@moxxy/cli": patch
---

Fix "Mode not registered: tool-use" after the mode rename. A mode name persisted
anywhere (config `mode:`, `~/.moxxy/preferences.json`, a desktop workspace's
stored mode, a runner `setMode` RPC, a mid-turn mode hand-off) is now funneled
through a legacy-name map in `ModeRegistry.setActive`: it tries the literal name
first and falls back to the current name (`tool-use`→`default`,
`deep-research`→`research`; the removed `plan-execute`/`bmad`/`developer` →
`default`). A validly-registered name is never overridden, and a genuinely
unknown mode still throws. Exposes `migrateModeName(name)` from `@moxxy/sdk`.
