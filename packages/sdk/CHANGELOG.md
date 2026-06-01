# @moxxy/sdk

## 0.3.0

### Minor Changes

- d362a6b: Support sending documents (PDFs, Office/text) to the model. Adds a `document`
  `ContentBlock`, a `supportsDocuments` flag on `ModelDescriptor`, and a
  `'document'` `UserPromptAttachment` kind; `projectMessages` routes document
  attachments to the native block. The Anthropic, OpenAI, and Codex providers
  translate documents to their native shapes (Anthropic `document`, OpenAI
  `file`, Responses `input_file`), so attached files now reach the model for
  analysis instead of being dropped.

## 0.2.0

### Minor Changes

- 0afd61d: Make an active mode visually obvious while it's running.

  Modes can now advertise a presentation `badge` (`ModeDef.badge`), surfaced on
  `SessionInfo.activeModeBadge` so every channel sees it over the wire. Goal mode
  declares one, so activating it now shows a persistent indicator the user can't
  miss — even mid-loop, when the usual mode footer is replaced by the "Thinking"
  marker:

  - **TUI** — a reverse-video `GOAL` pill stays pinned to the status line for the
    whole run, alongside the busy spinner.
  - **Desktop** — a persistent accent banner above the composer plus an accented
    Mode chip, both lit/cleared the moment the mode switches.

## 0.1.3

### Patch Changes

- 93d9a2d: Publish with `pnpm publish` instead of `npm publish` so pnpm's `workspace:*` and `catalog:` protocols are rewritten to concrete version ranges in the published `package.json`.

  The previous `npm publish` shipped those protocols verbatim, so `npx @moxxy/cli init` failed on a clean machine with:

  ```
  npm error code EUNSUPPORTEDPROTOCOL
  npm error Unsupported URL Type "workspace:": workspace:*
  ```

  Both `@moxxy/cli` (`dependencies."@moxxy/sdk": "workspace:*"`, `zod: "catalog:"`) and `@moxxy/sdk` (`peerDependencies.zod: "catalog:"`) were affected, so both are republished.

## 0.1.0

### Minor Changes

- c4352f9: First published release of the `moxxy` CLI and SDK (off the `0.0.0` placeholder).
