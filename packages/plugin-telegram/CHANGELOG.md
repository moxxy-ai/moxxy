# @moxxy/plugin-telegram

## 0.27.0

### Minor Changes

- 502acf0: Slim wave, final batches: the whisper STT pair, the Telegram + Slack
  channels, provider-admin and mcp move out of the CLI binary — all seeded
  into the desktop (voice, Settings panels and Apps→Channels keep working
  offline) and installable on demand everywhere else. `moxxy telegram` /
  `moxxy channels start slack` on a slim install print the exact install
  command instead of "unknown command". `@moxxy/config` flips public as the
  channels' dependency closure. The kernel is now the plan's target set: the
  TUI, built-in tools, default mode, context floors, vault, plugins-admin,
  commands, memory, the two OAuth providers, and the dormant daemons.

### Patch Changes

- 87aac6d: Declare honest `isolation` capability specs on the remaining admin and long-tail plugin tools (36 tools across 13 packages), completing the backfill that lets `security.requireDeclaration` be enabled.
- 5d6677d: New `@moxxy/channel-kit` package: shared channel-building machinery extracted from the Telegram and Slack channels (throttled send-once-then-edit FramePump, turnId-filtered turn running + single-flight TurnCoordinator, host-code and TOFU pairing state machines, env→vault secret resolution, audited allow-list permissions, and the inbound-webhook ingest HTTP scaffold + delivery dedupe cache). plugin-telegram and plugin-channel-slack are refactored onto it with no behavior change, so upcoming channels (Discord, WhatsApp, Signal) can be thin adapters.
- 81e6b68: Voice replies for the Telegram and Discord channels. When enabled with `/voice`, the channel synthesizes the final assistant reply through the session's active Synthesizer and sends it as a voice/audio message alongside the text.

  `@moxxy/channel-kit` gains the transport-agnostic pieces: `synthesizeReply` (TTS via `session.synthesizers.tryGetActive()` with markdown→speech cleanup), `ensureOggOpus` (passthrough or ffmpeg transcode, plain-audio fallback when ffmpeg is absent), `deliverVoiceReply`, and a shared `/voice` toggle resolver. The text reply always goes out first and every failure mode is a typed result, so a missing synthesizer, TTS error, or transcode failure never breaks the text answer. Messenger-specific delivery (grammy `sendVoice`/`sendAudio`, discord.js audio attachment) stays in each plugin.

- 3b27404: `moxxy onboard` — one guided command from a fresh install to a paired, always-on agent: provider wizard (skipped when configured) → messenger pick from the install catalog → version-pinned install + `moxxy.setup` fields → the channel's own pairing in a new pair-then-return mode (`EXIT_AFTER_PAIR_FLAG` in the SDK, honored by all five pair flows) → a `moxxy serve --all` background unit. Also: channel install hints are now derived from catalog `provides` (telegram/slack/web/http entries gained theirs), Telegram + Slack declare `moxxy.setup` token steps, the `service` catalog's serve unit actually starts channels (`--all`, matching its description), and service units survive Electron-as-node installs (`ELECTRON_RUN_AS_NODE=1` exported into the unit).
- Updated dependencies [87aac6d]
- Updated dependencies [03e5f87]
- Updated dependencies [5d6677d]
- Updated dependencies [81e6b68]
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [6460cc6]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [e5ea7e6]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [b2a5fba]
- Updated dependencies [502acf0]
- Updated dependencies [be28d55]
  - @moxxy/config@0.27.0
  - @moxxy/core@0.27.0
  - @moxxy/plugin-vault@0.27.0
  - @moxxy/channel-kit@0.27.0
  - @moxxy/sdk@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0
  - @moxxy/core@0.26.0
  - @moxxy/config@0.26.0
  - @moxxy/plugin-vault@0.26.0

## 0.1.4

### Patch Changes

- @moxxy/sdk@0.25.0
- @moxxy/core@0.25.0
- @moxxy/config@0.25.0
- @moxxy/plugin-vault@0.0.38

## 0.1.3

### Patch Changes

- @moxxy/sdk@0.24.1
- @moxxy/core@0.24.1
- @moxxy/config@0.24.1
- @moxxy/plugin-vault@0.0.37

## 0.1.2

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/config@0.24.0
  - @moxxy/core@0.24.0
  - @moxxy/plugin-vault@0.0.36

## 0.1.1

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/config@0.23.0
  - @moxxy/core@0.23.0
  - @moxxy/plugin-vault@0.0.35

## 0.1.0

### Minor Changes

- 48542df: Make "runs on a dedicated runner" a property a channel declares, and give
  Telegram the same dedicated-runner treatment as Slack.

  - `ChannelDef` gains optional `dedicatedRunner?: boolean` and
    `sessionSource?: SessionSource`. A channel now declares for itself that it
    should run on its own isolated runner (a distinct runner socket plus a sticky
    session, separate from the runner serving your desktop/TUI). The CLI reads
    this generically — there's no longer a hardcoded `name === 'slack'` check.
    `--dedicated` / `MOXXY_DEDICATED_RUNNER=1` remain runtime opt-ins, and a
    caller that already pinned the socket/session id/source (e.g. a supervisor)
    still wins.
  - `@moxxy/plugin-telegram` now declares `dedicatedRunner: true` +
    `sessionSource: 'telegram'`, so the Telegram bot runs on its own dedicated,
    isolated runner with persistent history (`moxxy-channel-telegram`), matching
    Slack. Telegram long-polls, so this needs no tunnel/webhook.
  - `@moxxy/plugin-channel-slack` now declares its dedicated-runner behavior
    explicitly (previously implicit in the CLI). No behavior change.
  - `SessionSource` gains `'telegram'`. `DeskSession.source` in
    `@moxxy/desktop-ipc-contract` now references the single `SessionSource` source
    of truth in `@moxxy/sdk` instead of a hand-copied union.

- b6c8405: Richer, tidier Telegram messages with first-class use of Telegram's formatting.

  - **Collapsible tool trace.** The per-turn tool-activity block stays open and
    live while the agent works, then folds into an expandable `🔧 N steps`
    blockquote on the final message — the reply leads with the answer and the
    step-by-step detail is one tap away.
  - **Detail-hiding Markdown extensions** the model can opt into: `~~strike~~`
    (`<s>`), `||spoiler||` (`<tg-spoiler>`), and GitHub/Obsidian-style callout
    boxes via `> [!type] Title`. A trailing `-` starts the box collapsed
    (`> [!details]- Raw logs`), `+` forces it open; `details`/`example`/`faq`
    collapse by default. A long plain `>` quote auto-collapses too.
  - The message splitter now closes/reopens `<blockquote expandable>` and
    hyphenated Telegram tags (`<tg-spoiler>`) across the 4096-char cut, so split
    messages stay valid HTML.
  - `telegram_send_message` (used by scheduled/one-off pushes) now renders its
    text with the same Markdown→Telegram formatting by default, with a plain-text
    fallback; pass an explicit `parseMode` to opt out and send verbatim.

### Patch Changes

- 069cd0e: Run & control channels (Slack / Telegram) directly from the TUI and the CLI.

  - **`/channels` TUI panel**: a control panel inside the interactive TUI — list the
    configurable channels with live status (running · pid · uptime, plus the Slack
    Request URL once its tunnel opens), enter each channel's secrets into the vault,
    and Start / Stop it without leaving the chat. A channel started here runs
    **detached on its own dedicated runner**, so it keeps serving after you quit the
    TUI and is discovered/stopped from anywhere.
  - **`moxxy channels start|stop|status`**: headless lifecycle verbs for the same
    detached runners — `start <name>` validates the channel is configured (via its
    own availability gate) then spawns it, `status [name]` lists what's running
    (status-file read; instant, no session boot), `stop <name>` SIGTERMs it.
    `moxxy <channel>` (and `moxxy channels <name>`) still run in the foreground.
  - A channel now **self-describes its config** on its `ChannelDef`
    (`config: { fields: [{ label, vaultKey, secret, … }], hasRequestUrl, runHint }`),
    so any control surface renders the setup form + "configured" check from the
    registry instead of a hardcoded table. Slack and Telegram declare theirs.
  - New `@moxxy/sdk/server` runtime helpers power all of the above, keyed entirely
    off the per-channel status file (process-independent): `spawnDedicatedChannel`,
    `liveChannelStatus`, `listLiveChannelStatuses`, `stopDedicatedChannel`,
    `isPidAlive` — stale files (a crashed runner's dead pid) self-heal on read.
  - Fix: the Telegram channel now honors the `MOXXY_TELEGRAM_TOKEN` env override at
    start (precedence: explicit option → env → vault), matching its own
    `isAvailable` gate and error message + Slack's behavior. Previously a headless
    start with only the env var set passed the availability check but then failed to
    boot ("token not found").

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/config@0.22.0
  - @moxxy/core@0.22.0
  - @moxxy/plugin-vault@0.0.34

## 0.0.38

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/core@0.21.1
- @moxxy/config@0.21.1
- @moxxy/plugin-vault@0.0.33

## 0.0.37

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/core@0.21.0
  - @moxxy/config@0.21.0
  - @moxxy/plugin-vault@0.0.32

## 0.0.36

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [497e9a1]
- Updated dependencies [bddaa83]
- Updated dependencies [e3491a9]
- Updated dependencies [5c1c334]
- Updated dependencies [238e434]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/core@0.7.0
  - @moxxy/config@0.2.0
  - @moxxy/plugin-vault@0.0.31

## 0.0.35

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/core@0.6.3
  - @moxxy/plugin-vault@0.0.30

## 0.0.34

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/core@0.6.2
  - @moxxy/plugin-vault@0.0.29

## 0.0.33

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/core@0.6.1
  - @moxxy/plugin-vault@0.0.28

## 0.0.32

### Patch Changes

- Updated dependencies [3862cb2]
  - @moxxy/core@0.6.0

## 0.0.31

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/core@0.5.4
  - @moxxy/plugin-vault@0.0.27

## 0.0.30

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/core@0.5.3
  - @moxxy/plugin-vault@0.0.26

## 0.0.29

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/core@0.5.2
  - @moxxy/plugin-vault@0.0.25

## 0.0.28

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/core@0.5.1
  - @moxxy/plugin-vault@0.0.24

## 0.0.27

### Patch Changes

- Updated dependencies [4bdd6f8]
  - @moxxy/core@0.5.0

## 0.0.26

### Patch Changes

- Updated dependencies [0870222]
  - @moxxy/core@0.4.0

## 0.0.25

### Patch Changes

- Updated dependencies [6c48c28]
  - @moxxy/core@0.3.0

## 0.0.24

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/core@0.2.9
  - @moxxy/plugin-vault@0.0.23

## 0.0.23

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/core@0.2.8
  - @moxxy/plugin-vault@0.0.22

## 0.0.22

### Patch Changes

- Updated dependencies [897a1fc]
- Updated dependencies [897a1fc]
  - @moxxy/plugin-vault@0.0.21
  - @moxxy/sdk@0.14.4
  - @moxxy/core@0.2.7

## 0.0.21

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/core@0.2.6
  - @moxxy/plugin-vault@0.0.20

## 0.0.20

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/core@0.2.5
  - @moxxy/plugin-vault@0.0.19

## 0.0.19

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1
  - @moxxy/core@0.2.4
  - @moxxy/plugin-vault@0.0.18

## 0.0.18

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/core@0.2.3
  - @moxxy/plugin-vault@0.0.17

## 0.0.17

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/core@0.2.2
  - @moxxy/plugin-vault@0.0.16

## 0.0.16

### Patch Changes

- 7366a09: Add a cross-channel file-diff preview for the Write/Edit tools. Every surface
  now shows what changed when the agent writes a file — a classic diff of the
  changed slices (±2 context lines) with line numbers, `+`/`-` markers, and
  green/red line backgrounds, plus a "Added N lines, removed M lines" summary.

  - The tools return a structured, channel-agnostic payload (`ToolDisplayResult`
    = `{ forModel, display }`); the model still sees only a short summary line, so
    the diff never bloats the context window.
  - TUI: an inline highlight preview; `Ctrl+O` expands the changed files.
  - Desktop: a diff card; click to expand the full set of hunks.
  - Web / Telegram / mobile each render the same payload natively.

  New public SDK surface (`@moxxy/sdk` and the dependency-free `@moxxy/sdk/tool-display`
  subpath for browser/React-Native consumers): `FileDiffDisplay`, `DiffHunk`,
  `DiffLine`, `DiffRow`, `ToolDisplay`, `ToolDisplayResult`, and the helpers
  `isToolDisplayResult`, `isFileDiffDisplay`, `fileDiffSummary`, `fileDiffVerb`,
  `diffGutterNo`, `toDiffRows`.

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/core@0.2.1
  - @moxxy/plugin-vault@0.0.15

## 0.0.15

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/core@0.2.0
  - @moxxy/plugin-vault@0.0.14

## 0.0.14

### Patch Changes

- Updated dependencies [4c594d8]
  - @moxxy/core@0.1.0

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0
  - @moxxy/core@0.0.13
  - @moxxy/plugin-vault@0.0.13

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/plugin-vault@0.0.12
  - @moxxy/core@0.0.12

## 0.0.11

### Patch Changes

- cf2f651: Audit wave: documentation drift + dead-code cleanup.

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

- cf2f651: Security: four audit leftovers (A43–A46). MCP server credentials now support `${vault:NAME}` placeholders in env/header values, resolved only at connect time (the persisted mcp.json and the model-visible tool args keep the placeholder; `mcp_add_server`/`mcp_test_server` instruct vault-first). Agent-view URLs are scheme-allow-listed (`https`/`http`/`mailto`/`tel` + relative; `data:image/*` for img src only) at BOTH walls: a canonical `isSafeViewUrl` in the sdk enforced by `parseView` and `validateDoc`, and a render-time re-check in the web frontend that neutralizes `javascript:`/`data:text` hrefs and srcs. `web_fetch` closes its DNS-rebinding TOCTOU by pinning every hop's connection to the SSRF-guard-vetted addresses via an undici dispatcher with a fixed lookup (SNI/cert validation intact). Telegram inline-keyboard callbacks now enforce the same pairing authorization gate as text/voice messages.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/core@0.0.11
  - @moxxy/plugin-vault@0.0.11

## 0.0.10

### Patch Changes

- f3c798f: `/new` now truly resets the session everywhere (audit A10). New `session.reset` runner RPC (protocol v3) + optional `SessionLike.reset()` capability: the runner aborts in-flight turns and clears its authoritative event log; the log's new `EventLog.onClear` listeners broadcast a `session.reset` notification so every attached mirror clears in lockstep (re-arming seq-0 ingest instead of silently rejecting all further events) and truncate the persisted session JSONL so wiped history can't resurrect on `--resume` — fixing the same resurrection bug for local `/new`. The TUI and Telegram `/new` paths call `reset()` (falling back to `log.clear()` when the capability is absent) and report an error instead of claiming "history cleared" when the reset RPC fails.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [05d643a]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/core@0.0.10
  - @moxxy/sdk@0.8.0
  - @moxxy/plugin-vault@0.0.10

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/core@0.0.9
  - @moxxy/plugin-vault@0.0.9

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/core@0.0.8
  - @moxxy/plugin-vault@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/core@0.0.7
  - @moxxy/plugin-vault@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/core@0.0.6
  - @moxxy/plugin-vault@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/core@0.0.5
  - @moxxy/plugin-vault@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/core@0.0.4
  - @moxxy/plugin-vault@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/core@0.0.3
  - @moxxy/plugin-vault@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/core@0.0.2
  - @moxxy/plugin-vault@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
  - @moxxy/core@0.0.1
  - @moxxy/plugin-vault@0.0.1
