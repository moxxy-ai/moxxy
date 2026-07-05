# @moxxy/plugin-plugins-admin

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1
  - @moxxy/config@0.28.1

## 0.28.0

### Patch Changes

- d47214f: feat(voice): @moxxy/plugin-stt-local — offline Whisper STT (multilingual) with on-demand verified model downloads

  Adds a fully local, on-device speech-to-text Transcriber — the input sibling of
  `@moxxy/plugin-tts-local`:

  - `@moxxy/plugin-stt-local` — the `local-whisper` transcriber running sherpa-onnx
    multilingual Whisper (English + Polish are the priority) in a forked sidecar
    (so the native addon's shared libs resolve via `DYLD_/LD_LIBRARY_PATH` set at
    process start). Models (`tiny` / `base` / `small`; default `base`, `small`
    recommended for Polish) download once on first use from sherpa-onnx's pinned
    `asr-models` release, sha256-verified against its `checksum.txt`. No API key,
    no network at transcription time.
  - Inbound audio is decoded to the Float32 mono @ 16 kHz sherpa wants: raw PCM16
    (the mic contract) and 16-bit PCM WAV are converted + resampled IN-PROCESS
    (no ffmpeg); compressed containers (ogg/opus voice notes, mp3, m4a, webm) go
    through ffmpeg when present, and raise a clear install-hint error when it
    isn't — raw PCM / WAV keep working regardless.
  - Registered side-effect free (no auto-adopt); the host/user activates it via
    `session.transcribers.setActive('local-whisper', { model, language })`.
    Channel voice notes (Telegram) consume the active transcriber transparently.

  plugins-admin gains an `stt-local` catalog entry for install-on-first-use.

- 534e3aa: New `@moxxy/plugin-tts-elevenlabs` — a second Synthesizer backend alongside OpenAI TTS. Text-to-speech via ElevenLabs' `POST /v1/text-to-speech/{voiceId}` (one JSON POST with an `xi-api-key` header returning audio bytes, no vendor SDK dependency). Registers a single `elevenlabs` synthesizer that the `SynthesizerRegistry` can adopt as the active read-aloud voice; the agent switches via `set_voice`. Config surface: `voiceId` (default Rachel `21m00Tcm4TlvDq8ikWAM`), `model` (default `eleven_multilingual_v2`), `format` (default `mp3_44100_128` → `audio/mpeg`; also `mp3_44100_64` / `mp3_22050_32`, all mp3 → `audio/mpeg`). `SynthesizeOptions.voice` overrides the configured voice id; `rate` is intentionally ignored (ElevenLabs has no stable model-agnostic speaking-rate parameter); `signal` cancels the request; input over a conservative 2500-char cap is truncated at a sentence boundary with an ellipsis. Headerless PCM/µ-law formats and opus are deliberately omitted (raw PCM has no container; the opus token is not confidently known for this endpoint) rather than surfaced under a bogus MIME type. The API key rides the vault (`ELEVENLABS_API_KEY`) with a `process.env` fallback; a missing key and HTTP/network failures surface as classified `MoxxyError`s. Setup declares one required secret field, so skipping setup correctly leaves the package disabled. Added to the plugins-admin install catalog as `tts-elevenlabs`.
- bba28c0: feat(voice): @moxxy/plugin-tts-local — offline Piper TTS (EN+PL) with on-demand verified model downloads

  Adds a fully local, on-device text-to-speech Synthesizer plus the shared
  download-and-verify helper it relies on:

  - `@moxxy/model-fetch` — HTTPS download with a host allow-list, streamed
    mandatory-sha256 verification, `.partial`→atomic-rename publish, a size cap,
    throttled progress, and hardened `.tar.bz2` extraction (path-traversal /
    symlink rejection). `ensureModel` ties download + extract behind an
    idempotent marker.
  - `@moxxy/plugin-tts-local` — the `local-piper` synthesizer running sherpa-onnx
    Piper voices (English + Polish) in a forked sidecar (so the native addon's
    shared libs resolve via `DYLD_/LD_LIBRARY_PATH` set at process start). Voice
    models download once on first use from sherpa-onnx's pinned releases,
    sha256-verified against its `checksum.txt`. No API key, no network at
    synthesis time. Consumed transparently by desktop read-aloud, the TUI, and
    channel voice replies via the runner-side SynthesizerRegistry.

  plugins-admin gains a `tts-local` catalog entry for install-on-first-use.

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0
  - @moxxy/config@0.28.0

## 0.27.0

### Minor Changes

- 49b1d73: Install-time capability consent + third-party requireDeclaration ratchet.
  Installing a plugin now surfaces the package's combined capability surface
  (fs globs, net mode/hosts, env, exec commands, time/memory budgets) in
  human-readable rows shared across every surface. Third-party packages
  (outside the `@moxxy/` scope) require explicit consent to stay enabled:
  the TUI opens a fail-closed post-install picker (ESC = decline = disabled),
  `moxxy plugins install` asks a default-NO confirm on a TTY and headless runs
  need `--yes` (otherwise the package is left installed but disabled), and the
  permission-gated `install_plugin` model tool keeps returning the report
  non-interactively. Undeclared tools are called out loudly — their surface is
  unknown, not empty. New `security.thirdPartyRequireDeclaration: off|warn|enforce`
  ('warn' by default while security is enabled) logs a once-per-tool structured
  warning — or denies with 'enforce' — when a third-party tool has no isolation
  declaration; unattributed tools (e.g. runtime-attached MCP tools) are exempt.
  `moxxy security status` prints the new mode.
- 0b6f40e: Plugin-declared init hooks: plugins can now ship a declarative setup step at
  `package.json#moxxy.setup` (title, required flag, typed fields:
  secret/string/boolean/select). `moxxy init` walks every installed plugin's
  step — secrets go to the VAULT with a `${vault:NAME}` ref written to the
  plugin's `options.<key>` (resolved at boot, never plaintext), other kinds
  persist through the shared schema-validated writer; skipping a
  `required: true` setup leaves the package DISABLED until configured; re-runs
  prefill ("enter to keep"). Installing such a plugin (tool or /plugins picker)
  surfaces `needsSetup` so the user is pointed at the configuration
  immediately. Proof: the HTTP channel declares its bearer token as a required
  secret field.
- 2cff46b: Post-install setup resolves IN the TUI: installing a plugin that declares a
  `moxxy.setup` step now opens a configuration dialog on the spot (masked
  secrets, y/n booleans, select lists) instead of pointing at `moxxy init` —
  values persist through the same shared writer (secrets → vault +
  `${vault:NAME}` option refs). New `/setup [package]` command (re)configures
  any installed plugin and re-enables one left disabled by a skipped required
  setup. New `PluginsAdminView.setupSpec`/`applySetup` seams; the init wizard
  now shares the exact same `applySetupValues` write path.
- 98f545c: Package-level capability aggregation: `moxxy security audit --package <name>` shows one package's tools plus their COMBINED capability surface (widest-wins union via the new `aggregateCapabilitySpecs` in the SDK), `--by-package` prints a declared/total rollup per plugin, and `install_plugin` now reports the just-installed package's capability surface (declared/total + undeclared tool names) next to the registration diff. Tool→plugin attribution comes from the plugin host's loaded records (`PluginHost.ownerOfTool`), which also makes the previously-dormant `security.perPlugin` isolator overrides actually route.
- 6f0e6fb: Signed plugin-registry v1, client side: Ed25519-verified `index.json` fetch with a re-verified 1h cache at `~/.moxxy/registry-cache.json` and hardcoded-catalog fallback on any failure (never throws into the install path). Catalog installs that resolve through a signed entry install the signature-covered exact version (pin precedence: user `--version` > signed index > cliVersion lockstep > latest), and `install_plugin` warns when the registered capability surface is wider than the signed manifest. Dormant until a maintainer key is baked into `REGISTRY_PUBLIC_KEY` (empty = disabled, exactly like the desktop update key).
- fa3922e: Slim wave, batches 3+4: `@moxxy/plugin-browser`, `@moxxy/plugin-terminal`
  and `@moxxy/plugin-channel-web` move out of the CLI binary and install on
  demand (all three are in the desktop plugins-seed, so desktop surfaces keep
  working offline). The CLI's `dist/` drops the Playwright `sidecar.js` entry
  and the copied web frontend — a standalone browser install resolves its own
  `dist/sidecar.js`, and the web channel serves its own `dist/public` next to
  its module. `node-pty` moves from the CLI's optionalDependencies into
  plugin-terminal's own (piped-shell fallback without it).
  `@moxxy/plugin-tunnel-proxy` + `@moxxy/e2e` flip public as web's dependency
  closure; `@moxxy/e2e` joins the fixed changeset group so pinned installs
  resolve from their first release.
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
- 6460cc6: The slim wave's last unbundle: `@moxxy/plugin-memory` moves out of the CLI
  binary as ONE merged plugin (long-term store + memory tools + the tfidf
  embedder + memory_consolidate and its nudge hooks — the two-plugins-in-one-
  package blocker is gone). The store's embedder now resolves lazily from the
  new core-published `embedders` service instead of a bootstrap closure.
  Installs on demand / rides the desktop seed; without it, `moxxy doctor`
  reports a warn ("memory plugin not installed") instead of failing and
  recall degrades exactly as before. The `@moxxy/memory-consolidate` ledger
  key is gone (clean-slate) — enable/disable the one package instead.
- 3b27404: `moxxy onboard` — one guided command from a fresh install to a paired, always-on agent: provider wizard (skipped when configured) → messenger pick from the install catalog → version-pinned install + `moxxy.setup` fields → the channel's own pairing in a new pair-then-return mode (`EXIT_AFTER_PAIR_FLAG` in the SDK, honored by all five pair flows) → a `moxxy serve --all` background unit. Also: channel install hints are now derived from catalog `provides` (telegram/slack/web/http entries gained theirs), Telegram + Slack declare `moxxy.setup` token steps, the `service` catalog's serve unit actually starts channels (`--all`, matching its description), and service units survive Electron-as-node installs (`ELECTRON_RUN_AS_NODE=1` exported into the unit).
- 2cef8e1: feat(reflector): swappable `reflector` registry category + `@moxxy/reflector-default` learning loop.

  A new single-active registry category — the learning-loop block that watches a finished turn and _proposes_ memory/skill improvements without ever writing silently. Mirrors the `eventStore` category across all 7 layers (config `plugins.reflector.default`, SDK `ReflectorDef`/`ReflectContext`/`ReflectionProposal` contract + plugin slot, core `ReflectorRegistry`, host registry-kind wiring, session field + `services('reflectors')`, CLI apply/category-swap, catalog), but NULLABLE: core seeds no floor, so reflection is opt-in (like transcriber/synthesizer).

  `@moxxy/reflector-default` (discovery-loaded) ships the default `ReflectorDef` `'default'` AND the driver in one plugin. The driver's `onTurnEnd` runs a cheap gate (≥5 tool results OR ≥1 error OR ≥8 mode iterations) under a one-reflection-per-session budget, then fires the reflection FIRE-AND-FORGET so it never blocks or throws into the turn. The reflector does one cheap side-channel LLM pass over a turn digest and returns 0-2 proposals; those are delivered as a ONE-TIME nudge on the next `onBeforeProviderCall`, phrased so the model MAY call `memory_save` / `synthesize_skill` — which still hit their own permission prompts. No silent writes. Graceful no-provider / provider-error skips; `memory_save` and `synthesize_skill` are declared as optional requirements. User-model injection of proposals is deferred to a follow-up PR.

- 2e37663: New `@moxxy/plugin-tts-openai` — the first Synthesizer backend. Text-to-speech via OpenAI's `POST /v1/audio/speech` (one JSON POST returning audio bytes, no `openai` SDK dependency). Registers a single `openai-tts` synthesizer that the `SynthesizerRegistry` auto-adopts as the active read-aloud voice on install; the agent switches via `set_voice`. Config surface: `model` (default `gpt-4o-mini-tts`), `voice` (default `alloy`), `format` (default `mp3` → `audio/mpeg`; also `opus`/`wav`/`aac`). `SynthesizeOptions.voice` overrides the configured voice, `rate` maps to OpenAI `speed` clamped to 0.25–4.0, `signal` cancels the request, and input over OpenAI's 4096-char limit is truncated at a sentence boundary with an ellipsis. The API key rides the vault (`OPENAI_API_KEY`, shared with the OpenAI provider) with a `process.env` fallback; a missing key and HTTP/network failures surface as classified `MoxxyError`s. Added to the plugins-admin install catalog as `tts-openai`.
- Updated dependencies [87aac6d]
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [e5ea7e6]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [502acf0]
- Updated dependencies [be28d55]
  - @moxxy/config@0.27.0
  - @moxxy/sdk@0.27.0

## 0.26.0

### Minor Changes

- 8c70f3c: Install-on-first-use: asking for a capability whose package isn't installed
  now offers to install it at the point of use instead of failing. `/goal` and
  `/collab` without their mode installed open an install-confirm picker and,
  after the install lands, re-run the original command; the `/mode` picker
  lists catalog-provided modes badged "installs on first use"; `set_default`
  naming an uninstalled contribution throws a typed `PLUGIN_NOT_INSTALLED`
  error carrying the providing package (so the model tool gets an actionable
  hint too). Catalog entries gain a `provides` mapping (category + contribution
  name) that powers the lookup.
- ce56ef6: The `/plugins` Installable tab now actually installs: selecting a catalog
  plugin npm-installs it into `~/.moxxy/plugins`, persists the enable,
  hot-reloads the plugin host, and reports which contributions registered —
  instead of printing a CLI command to run elsewhere. New optional
  `PluginsAdminView.install` seam (RemoteSession degrades to the printed
  command).

  On-demand installs are now version-pinned: bare `@moxxy/*` specs resolve at
  the CLI's own version across every install path (`install_plugin` tool,
  `moxxy plugins install`, init's provider/extras steps, the TUI picker), with
  a 404→latest retry for pins an older CLI can't satisfy. The changeset fixed
  group widens to all `@moxxy/plugin-*` + `@moxxy/mode-*` so future releases
  co-version. New `installPluginPackagePinned` / `pinFirstPartySpec` exports.

- 386e526: Slim wave, batch 1: seven plugins move out of the CLI binary and install on
  demand from npm — `@moxxy/mode-goal`, `@moxxy/mode-deep-research` (now
  npm-depends on `@moxxy/plugin-subagents` so one install brings both),
  `@moxxy/plugin-subagents`, `@moxxy/plugin-oauth`,
  `@moxxy/plugin-computer-control`, `@moxxy/plugin-channel-http`,
  `@moxxy/plugin-usage-stats`. All are in the installable catalog (the
  `/plugins` picker installs them one-keystroke; `/goal`, `/collab` and `/mode`
  offer the install at point of use), and `moxxy init` installs a picked
  non-bundled default mode during setup so the written config never floors
  back on first boot. New `scripts/e2e-slim-install.mjs` fresh-install smoke.
- 386e526: Slim wave, batch 2: `@moxxy/plugin-view`, `@moxxy/plugin-self-update` and
  `@moxxy/plugin-voice-admin` (plugin renamed from `@moxxy/voice-admin` to
  match its package) move out of the CLI binary and install on demand.
  `@moxxy/plugin-provider-admin` + `@moxxy/plugin-mcp` (entry alias
  `@moxxy/plugin-mcp-admin` dropped — the plugin now registers under its
  package name) flip publishable as prep but stay bundled until the desktop
  seed pack lands: the desktop Settings panels reach them through the
  `providerAdmin`/`mcpAdmin` session services on the spawned runner.
  self-update's staged-update finalizer stays inlined in the binary (bin.ts
  imports it statically); only the registered plugin instance moves out.

### Patch Changes

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
  - @moxxy/sdk@0.26.0
  - @moxxy/config@0.26.0

## 0.2.6

### Patch Changes

- @moxxy/sdk@0.25.0
- @moxxy/config@0.25.0

## 0.2.5

### Patch Changes

- @moxxy/sdk@0.24.1
- @moxxy/config@0.24.1

## 0.2.4

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/config@0.24.0

## 0.2.3

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/config@0.23.0

## 0.2.2

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/config@0.22.0

## 0.2.1

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/config@0.21.1

## 0.2.0

### Minor Changes

- 05df794: `/plugins` now distinguishes **built-in** (bundled) from **installed** (on-demand from `~/.moxxy/plugins`) packages instead of showing everything as "on": the plugin host reports `installed` (manifest present = discovered) and the Packages tab badges core / installed / built-in. The Installable catalog is also populated with the six unbundled API-key providers (anthropic, openai, google, xai, zai, local) so they can be installed from the picker (and the init optional-plugins step).

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/config@0.21.0

## 0.1.0

### Minor Changes

- 2ccd62e: Unified `plugins:` manifest + critical floor (Pillar 1).

  Replace the three overlapping config stores (the flat `provider`/`mode`/`compactor`/`workflowExecutor` keys, the package-keyed `plugins:` map, and `~/.moxxy/preferences.json`) with a single category-grouped `plugins:` tree in `~/.moxxy/config.yaml`:

  - **`plugins.packages.<pkg>`** — the install/enable ledger (one entry per npm package).
  - **`plugins.<category>.{default, items}`** — the swap axis, one slot per registry kind, keyed by contribution name (e.g. `plugins.provider.default: anthropic`).

  A **critical floor** makes the platform unbreakable: core default modules can be _swapped_ to another registered implementation but never _disabled_ — a missing/typo'd default reverts to a protected built-in floor, kernel packages refuse to be disabled (`PLUGIN_PROTECTED`), and a boot assertion guarantees every non-nullable slot is filled.

  New swap surfaces: the `set_default`/`list_defaults` model tools, `moxxy plugins set-default`/`defaults`, the TUI `/plugins` **Defaults** tab, and a `PluginsAdminView.categories()`/`setCategoryDefault()` view contract.

  `preferences.json` is retired: the persisted provider/mode/model/disabled-set now live in the same tree, written through `@moxxy/config` (`setCategoryDefault`/`setProviderModel`/`setProviderEnabled`). **Breaking (pre-1.0, no back-compat):** existing `~/.moxxy/config.yaml` files using the old keys must be rewritten; `moxxy init`'s output and `config_init`'s template emit the new shape.

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/config@0.2.0

## 0.0.30

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/config@0.1.15

## 0.0.29

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/config@0.1.14

## 0.0.28

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/config@0.1.13

## 0.0.27

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/config@0.1.12

## 0.0.26

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/config@0.1.11

## 0.0.25

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/config@0.1.10

## 0.0.24

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/config@0.1.9

## 0.0.23

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/config@0.1.8

## 0.0.22

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/config@0.1.7

## 0.0.21

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4
  - @moxxy/config@0.1.6

## 0.0.20

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/config@0.1.5

## 0.0.19

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/config@0.1.4

## 0.0.18

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1
  - @moxxy/config@0.1.3

## 0.0.17

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/config@0.1.2

## 0.0.16

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/config@0.1.1

## 0.0.15

### Patch Changes

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0
  - @moxxy/config@0.1.0

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/config@0.0.14

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0
  - @moxxy/config@0.0.13

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/config@0.0.12

## 0.0.11

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/config@0.0.11

## 0.0.10

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0
  - @moxxy/config@0.0.10

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/config@0.0.9

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/config@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/config@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/config@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/config@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
