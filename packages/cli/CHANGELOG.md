# @moxxy/cli

## 0.3.3

### Patch Changes

- d362a6b: Support sending documents (PDFs, Office/text) to the model. Adds a `document`
  `ContentBlock`, a `supportsDocuments` flag on `ModelDescriptor`, and a
  `'document'` `UserPromptAttachment` kind; `projectMessages` routes document
  attachments to the native block. The Anthropic, OpenAI, and Codex providers
  translate documents to their native shapes (Anthropic `document`, OpenAI
  `file`, Responses `input_file`), so attached files now reach the model for
  analysis instead of being dropped.
- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.3.2

### Patch Changes

- 6dea644: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.3.1

### Patch Changes

- f3e3f1e: Fix tool calls getting stuck "running" forever (flipping to error only on the next message). When the stuck-loop detector tripped, `mode-tool-use` (the default mode) and `mode-goal` ended the turn after emitting `tool_call_requested` but before running the call — orphaning it with no `tool_result`. The turn still completed (re-enabling the composer), so the orphaned call spun indefinitely until the next `user_prompt` swept it into an error. Both modes now synthesize a failed result for every already-emitted request before bailing, matching the abort path and the already-correct plan-execute/developer modes. This also stops the provider from rejecting the unresolved tool-use block on the following turn.

## 0.3.0

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

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.2.0

### Minor Changes

- df0593b: Add a `Sleep` built-in tool and a new `goal` mode (`/goal <objective>`).

  - **`Sleep` tool** — lets the agent pause for a set duration (`seconds` and/or `ms`, capped at
    5 minutes, abort-aware) to wait on an external/async process before re-checking, instead of
    busy-looping.
  - **`goal` mode + `/goal`** — `/goal <objective>` switches into the new `goal` mode,
    auto-approves every tool call (yolo) for the run, and starts working immediately. Unlike
    tool-use, the loop does NOT end when the model stops emitting tools — it keeps re-prompting
    the model to continue until the model explicitly calls the `goal_complete` tool (success,
    with a summary + evidence) or `goal_abandon` (blocked, needs the user). Every run is bounded
    by an iteration cap, a cumulative token budget, a stuck-loop detector, and no-progress
    detection, and stops immediately on user interrupt (Esc/Ctrl-C). Available in every channel
    via `/mode goal`.

### Patch Changes

- f469c0f: `moxxy init`: provider selection is now a single-choice picker instead of a multi-select.

  Users reported the old multi-select step was unintuitive — it wasn't obvious you had to toggle items on/off, and a required multi-select with nothing checked reads as a dead end. The wizard now uses a single `select` (one provider, pre-highlighted, just press Enter), which also removes the now-redundant "which provider should be primary?" step and renumbers the remaining steps (model → 3, mode → 4, embedder → 5, plugin-security → 6, review → 7). The generated `moxxy.config.yaml` is unchanged in shape, and you can still add more providers afterward via config `fallbacks` or the provider-admin tools. This matches the desktop app's onboarding, which already used a single-provider picker.

## 0.1.6

### Patch Changes

- bf8ef82: `moxxy login`: add a `--browser` flag that forces the loopback/browser OAuth flow even when stdin isn't a TTY.

  Previously a GUI host (the desktop app) that spawned `moxxy login <provider>` with piped stdio got the headless device-code flow — the user had to open a URL and type a code by hand. With `--browser`, the CLI runs the loopback flow that opens the system browser automatically and catches the localhost callback, so no copying is needed. (`--no-browser` still forces device-code.)

## 0.1.5

### Patch Changes

- f846b56: `moxxy serve` now boots even when no provider key is configured.

  Previously `serve` activated a provider at startup and exited 1 with `AUTH_NO_CREDENTIALS` when none was found — _before_ binding its socket. Clients (notably the desktop app) then looped forever on "lost the runner / reconnecting" and could never connect to add a provider. `serve` now boots with `tolerateNoProvider` (matching `channels` / `login`): it binds the socket with no active provider, and turns fail with a clear "no provider" error until one is configured.

## 0.1.4

### Patch Changes

- f07d698: Remove the two `npm install` deprecation warnings (`prebuild-install`, `boolean`) and slim the default install.

  `@moxxy/cli` no longer installs heavy native optional dependencies by default:

  - **keytar → `@napi-rs/keyring`**: keytar pulls the deprecated `prebuild-install`; `@napi-rs/keyring` ships per-platform NAPI prebuilds with no install scripts. OS-keychain unlock for the vault is preserved (it still falls back to the disk key / passphrase when the native binary is unavailable).
  - **`@huggingface/transformers` and `playwright` are now install-on-demand** (dropped from `optionalDependencies`). Both were already loaded via guarded dynamic `import()`; the local-embeddings and browser features degrade gracefully and prompt to install when first used. This is what pulled `boolean` (via `onnxruntime-node` → `global-agent`).

  Net effect: `npx @moxxy/cli` installs only `@moxxy/sdk`, `zod`, and `@napi-rs/keyring` — no deprecation warnings, smaller and faster.

- e73b51e: `moxxy init`: collect the vault passphrase as a styled first step instead of a bare prompt.

  On a first run the vault needs a passphrase to derive its encryption key. Previously this fired as an unstyled `readline` prompt _before_ the wizard (and before the logo). It's now a `@clack/prompts` `password` step — rendered under the moxxy logo, with a short description — so it reads as the first pre-requirement step of setup, consistent with the rest of the wizard. Threaded via a new `SetupOptions.passphrasePrompt`; headless `init` is unaffected (still uses `MOXXY_VAULT_PASSPHRASE` / the non-TTY guard).

## 0.1.3

### Patch Changes

- 93d9a2d: Publish with `pnpm publish` instead of `npm publish` so pnpm's `workspace:*` and `catalog:` protocols are rewritten to concrete version ranges in the published `package.json`.

  The previous `npm publish` shipped those protocols verbatim, so `npx @moxxy/cli init` failed on a clean machine with:

  ```
  npm error code EUNSUPPORTEDPROTOCOL
  npm error Unsupported URL Type "workspace:": workspace:*
  ```

  Both `@moxxy/cli` (`dependencies."@moxxy/sdk": "workspace:*"`, `zod: "catalog:"`) and `@moxxy/sdk` (`peerDependencies.zod: "catalog:"`) were affected, so both are republished.

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.1.0

### Minor Changes

- c4352f9: First published release of the `moxxy` CLI and SDK (off the `0.0.0` placeholder).

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
