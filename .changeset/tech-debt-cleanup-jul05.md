---
'@moxxy/cli': patch
'@moxxy/sdk': patch
'@moxxy/desktop': patch
---

Tech-debt backlog cleanup pass.

- CLI: new `moxxy channels rotate-token <name>` verb wrapping the SDK-only `rotateChannelToken` (SECURITY.md's hardening checklist recommended rotation but nothing exposed it).
- CLI: standalone `moxxy mobile` now stamps `MOXXY_SESSION_SOURCE=mobile` (via a declared `sessionSource` on the channel def) so the empty pre-first-prompt session is no longer mis-stamped `tui` and dropped from the mobile list.
- SDK: `resolveModelContext` no longer SILENTLY falls back to the first model descriptor on an unrecognized model id — it emits a one-shot `console.warn` (deduped per provider/requested-id/fallback-id) so a wrong context-window calibration is observable.
- Desktop: compile-time partition of the app-bridge method sets (`RENDERER_DISPATCHED_METHODS` vs the host `BridgeServices` map) so a mis-/un-classified method is now a `tsc` error rather than a runtime-test-only check.
- Desktop: the keyless `local` provider no longer prompts for a non-existent API key in the Configure sheet.
- Desktop: stop Vite emitting a ~21 MB orphan ONNX-Runtime wasm into `dist/assets/` on every bundle (the runtime loads ORT from `/ort/`; the emitted copy was dead); the real anonymizer wasm is untouched.
- Desktop: added a drift guard that fails if the hand-mirrored channel catalog diverges from each plugin's `ChannelDef.config`.
