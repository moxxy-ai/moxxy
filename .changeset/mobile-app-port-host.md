---
"@moxxy/plugin-channel-mobile": patch
"@moxxy/desktop-ipc-contract": patch
---

Mobile app port (phase 2a, data layer): the mobile channel's `MobileSessionHost` now serves the full command subset the Expo app drives — `session.setMode` (re-broadcasts the connected phase so clients see the new mode), `session.newSession` (aborts in-flight turns, then `SessionLike.reset()` with a `log.clear()` fallback), `session.runCommand` (the session command registry, channel `'mobile'`), voice (`session.hasTranscriber` probes the transcriber registry; `session.transcribe` runs the active transcriber or fails with the new coded `not-supported` error), and workflows (`workflows.list` returns the typed empty list when the plugin is absent; `workflows.run` fails coded `not-supported`). `session.runTurn` now forwards the new `inlineAttachments` to the session (mobile clients can't reference host paths, so the payload itself crosses the wire).

Contract additions (all additive): the `not-supported` `MoxxyIpcErrorCode` for capability-absent commands, `RunTurnArgs.inlineAttachments` (SDK `UserPromptAttachment` shape, size/count-bounded in validation), and boundary Zod schemas for `session.runCommand` (closing the audit-flagged gap — it was the one mutating session command without a schema, on desktop too), `workflows.run`, and `workflows.setEnabled`.
