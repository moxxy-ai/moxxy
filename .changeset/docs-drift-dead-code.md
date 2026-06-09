---
'@moxxy/sdk': patch
'@moxxy/core': patch
'@moxxy/plugin-telegram': patch
'@moxxy/cli': patch
---

Audit wave: documentation drift + dead-code cleanup.

- Removed dead exports: `@moxxy/core`'s unused `selectPendingToolCalls` / `selectCurrentTurn`
  event selectors and `@moxxy/sdk`'s unused voice helpers (`checkTranscriberReady`,
  `resolveTranscriber`, `pickFirstAvailableTranscriber`) — zero importers across the repo.
- `@moxxy/plugin-telegram` no longer declares `zod` as a dependency (it never imported it).
- CLI `--help` ENV section now lists the user-facing `MOXXY_*` variables and points at the
  new full table in the README.
- Docs-only (no release impact): AGENTS.md/README.md architecture lists reconciled against
  the actual package set (mode-default replaces the deleted mode-tool-use; PR #120 client
  layer + channel-web/view/mobile + apps/mobile added), the published `@moxxy/sdk` README
  examples rewritten against the real API, apps/docs corrections (tools-builtin reality,
  testing API, four providers, full package index), and the dead `lint` task removed from
  turbo.json.
