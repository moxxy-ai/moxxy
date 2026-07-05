# @moxxy/plugin-cli

## 0.28.1

### Patch Changes

- 027b26a: TUI read-aloud: a `/speak` command that voices the assistant's reply through
  the session's active `Synthesizer`. Bare `/speak` speaks the last reply;
  `/speak on|off` toggles sticky auto-speak of each final reply (in-memory, per
  TUI session); `/speak stop` halts current playback. Synthesis reuses
  `@moxxy/channel-kit`'s transport-agnostic `synthesizeReply`/`toSpeech`, and a
  new `audio-play` helper plays the bytes through the platform's system player —
  `afplay` (macOS), `paplay`/`aplay`/`ffplay` (Linux), or PowerShell
  `Media.SoundPlayer`/`ffplay` (Windows) — presence-probed (cached) and
  SIGKILLed on abort so a second `/speak` or Ctrl+C stops playback. Read-aloud is
  best-effort: a missing synthesizer (nudges to `moxxy plugins install tts-local`
  / `tts-openai`), TTS error, missing player, or non-zero exit all surface a
  subtle notice and never block input — replies always render as text.
- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1
  - @moxxy/channel-kit@0.28.1
  - @moxxy/chat-model@0.3.19
  - @moxxy/config@0.28.1
  - @moxxy/core@0.28.1
  - @moxxy/plugin-mcp@0.28.1
  - @moxxy/plugin-plugins-admin@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
- Updated dependencies [d47214f]
- Updated dependencies [534e3aa]
- Updated dependencies [bba28c0]
  - @moxxy/sdk@0.28.0
  - @moxxy/plugin-plugins-admin@0.28.0
  - @moxxy/chat-model@0.3.18
  - @moxxy/config@0.28.0
  - @moxxy/core@0.28.0
  - @moxxy/plugin-mcp@0.28.0

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
- 2cff46b: Post-install setup resolves IN the TUI: installing a plugin that declares a
  `moxxy.setup` step now opens a configuration dialog on the spot (masked
  secrets, y/n booleans, select lists) instead of pointing at `moxxy init` —
  values persist through the same shared writer (secrets → vault +
  `${vault:NAME}` option refs). New `/setup [package]` command (re)configures
  any installed plugin and re-enables one left disabled by a skipped required
  setup. New `PluginsAdminView.setupSpec`/`applySetup` seams; the init wizard
  now shares the exact same `applySetupValues` write path.
- ee2967d: `/settings` (alias `/config`): a curated in-TUI config panel — reasoning,
  prompt caching, elision, lazy tools, loop guard, plugin security, TUI theme
  and footer hints toggle/cycle in place, persist to the user config through
  the ONE schema-validated comment-preserving writer (new `setConfigValue`,
  which the `config_set` tool now also delegates to), and live-apply via the
  new optional `SessionLike.configAdmin` seam (RemoteSession degrades to
  "applies on restart"). New `tui:` config section (`theme: default|mono`,
  `hints`, `keys` Ctrl-letter overrides for force-send/drop-queued/
  expand-tools) projected onto the TUI's env conventions at launch.

### Patch Changes

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
- 2cef8e1: feat(reflector): swappable `reflector` registry category + `@moxxy/reflector-default` learning loop.

  A new single-active registry category — the learning-loop block that watches a finished turn and _proposes_ memory/skill improvements without ever writing silently. Mirrors the `eventStore` category across all 7 layers (config `plugins.reflector.default`, SDK `ReflectorDef`/`ReflectContext`/`ReflectionProposal` contract + plugin slot, core `ReflectorRegistry`, host registry-kind wiring, session field + `services('reflectors')`, CLI apply/category-swap, catalog), but NULLABLE: core seeds no floor, so reflection is opt-in (like transcriber/synthesizer).

  `@moxxy/reflector-default` (discovery-loaded) ships the default `ReflectorDef` `'default'` AND the driver in one plugin. The driver's `onTurnEnd` runs a cheap gate (≥5 tool results OR ≥1 error OR ≥8 mode iterations) under a one-reflection-per-session budget, then fires the reflection FIRE-AND-FORGET so it never blocks or throws into the turn. The reflector does one cheap side-channel LLM pass over a turn digest and returns 0-2 proposals; those are delivered as a ONE-TIME nudge on the next `onBeforeProviderCall`, phrased so the model MAY call `memory_save` / `synthesize_skill` — which still hit their own permission prompts. No silent writes. Graceful no-provider / provider-error skips; `memory_save` and `synthesize_skill` are declared as optional requirements. User-model injection of proposals is deferred to a follow-up PR.

- b2a5fba: Aggregate skill usage into `~/.moxxy/skills/.meta/usage.json` and surface it.

  A new best-effort store in `@moxxy/core` (`skill-usage.ts`) records per-skill-name
  `invocations` counts plus first-`createdAt` / latest-`lastInvokedAt` timestamps.
  `@moxxy/plugin-usage-stats` folds this run's `skill_invoked` / `skill_created`
  events past the same resume/`/new` seq boundary it already uses for token usage
  and merges the delta on shutdown (token behavior unchanged). `moxxy skills list`
  gains a dim `used` column and the `/skills` TUI panel shows a right-aligned `×N`
  badge.

  Known limitation: `skill_invoked` is only emitted by the `load_skill` tool today
  (reason `load_skill_tool`), so counts reflect explicit `load_skill` calls only.
  When trigger-match / classifier emission lands later, the same file simply starts
  counting more — no format change.

- Updated dependencies [87aac6d]
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
- Updated dependencies [6f0e6fb]
- Updated dependencies [b2a5fba]
- Updated dependencies [2e37663]
- Updated dependencies [fa3922e]
- Updated dependencies [502acf0]
- Updated dependencies [be28d55]
  - @moxxy/plugin-plugins-admin@0.27.0
  - @moxxy/plugin-mcp@0.27.0
  - @moxxy/config@0.27.0
  - @moxxy/core@0.27.0
  - @moxxy/sdk@0.27.0
  - @moxxy/chat-model@0.3.17

## 0.26.0

### Minor Changes

- 8c70f3c: Connect a provider without leaving the TUI: picking an unconnected provider
  in `/model` now opens an inline connect dialog that installs the provider if
  needed (pinned npm install), collects + validates an API key (stored in the
  vault, never persisted plaintext), or drives the provider's OAuth sign-in —
  then completes the exact model switch that was picked. Previously the picker
  told you to quit and run `moxxy init` / `moxxy login` and restart.

  New optional `SessionLike.providerSetup` (`ProviderSetupView`) seam; the init
  wizard delegates to the same implementation so wizard and dialog semantics
  cannot drift (a provider without `validateKey` now accepts the key instead of
  pseudo-rejecting it). RemoteSession keeps the old guidance notice.

### Patch Changes

- 8c70f3c: Install-on-first-use: asking for a capability whose package isn't installed
  now offers to install it at the point of use instead of failing. `/goal` and
  `/collab` without their mode installed open an install-confirm picker and,
  after the install lands, re-run the original command; the `/mode` picker
  lists catalog-provided modes badged "installs on first use"; `set_default`
  naming an uninstalled contribution throws a typed `PLUGIN_NOT_INSTALLED`
  error carrying the providing package (so the model tool gets an actionable
  hint too). Catalog entries gain a `provides` mapping (category + contribution
  name) that powers the lookup.
- 04738aa: Stop shipping the 16 MB `bin.js.map` sourcemap in the published npm tarball
  (unpacked size drops ~65%; local builds keep sourcemaps). Fix the TUI footer
  hint that advertised `^B toggle skills` — Ctrl+B drops the first queued
  message; the hint row now shows `^O tool detail` instead.
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

- Updated dependencies [8c70f3c]
- Updated dependencies [8c70f3c]
- Updated dependencies [ce56ef6]
- Updated dependencies [386e526]
  - @moxxy/sdk@0.26.0
  - @moxxy/core@0.26.0
  - @moxxy/plugin-mcp@0.26.0
  - @moxxy/chat-model@0.3.16
  - @moxxy/config@0.26.0

## 0.6.0

### Minor Changes

- f346b38: Make collaboration a fully separate feature that never touches your chats or their sessions.

  Previously `/collab` (and the desktop Collaborate tab) ran the coordinator **inside the active chat session** — it flipped that session's mode to `collaborative` and streamed the whole team's activity into the chat's own event log, so a collaboration polluted the chat thread and its transcript.

  Now the coordinator runs on its **own dedicated runner** — a new internal `moxxy collab` command that boots its own headless Session + runner socket, hosts the collab hub, and spawns the architect/implementer team exactly as before.

  - **Desktop:** the Collaborate panel supervises that coordinator (`CollabSupervisor`) and drives it over a dedicated `collab.*` IPC surface + `collab.event` / `collab.approval` broadcasts (a private `useCollab` hook, not `useChat`). The roster-approval checkpoint is answered inline in the panel.
  - **TUI:** `/collab <goal>` re-points the terminal onto the coordinator's own session (via the same in-place switch `/sessions` uses) and auto-submits the goal there — the roster approval and the live `◆ collab` block render as usual, but on the coordinator's session, not your chat. Bare `/collab` attaches to a running collaboration to view it; `/sessions` returns you to chat while the collaboration keeps running.

  Either way, a collaboration is entirely decoupled from every chat session — no mode-switch, no events in a chat's thread. The roster-approval checkpoint (the one human-in-the-loop gate) is preserved because the attaching UI drives the goal turn, so the coordinator's approval is forwarded to it. The single-flight lock now also records the coordinator's runner socket so a UI can discover and attach to a running coordinator (including one started elsewhere).

### Patch Changes

- @moxxy/sdk@0.25.0
- @moxxy/core@0.25.0
- @moxxy/config@0.25.0
- @moxxy/chat-model@0.3.15
- @moxxy/plugin-mcp@0.0.38

## 0.5.3

### Patch Changes

- @moxxy/sdk@0.24.1
- @moxxy/core@0.24.1
- @moxxy/config@0.24.1
- @moxxy/chat-model@0.3.14
- @moxxy/plugin-mcp@0.0.37

## 0.5.2

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/chat-model@0.3.13
  - @moxxy/config@0.24.0
  - @moxxy/core@0.24.0
  - @moxxy/plugin-mcp@0.0.36

## 0.5.1

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/chat-model@0.3.12
  - @moxxy/config@0.23.0
  - @moxxy/core@0.23.0
  - @moxxy/plugin-mcp@0.0.35

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/chat-model@0.3.11
  - @moxxy/config@0.22.0
  - @moxxy/core@0.22.0
  - @moxxy/plugin-mcp@0.0.34

## 0.4.1

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/core@0.21.1
- @moxxy/config@0.21.1
- @moxxy/chat-model@0.3.10
- @moxxy/plugin-mcp@0.0.33

## 0.4.0

### Minor Changes

- 05df794: `/plugins` now distinguishes **built-in** (bundled) from **installed** (on-demand from `~/.moxxy/plugins`) packages instead of showing everything as "on": the plugin host reports `installed` (manifest present = discovered) and the Packages tab badges core / installed / built-in. The Installable catalog is also populated with the six unbundled API-key providers (anthropic, openai, google, xai, zai, local) so they can be installed from the picker (and the init optional-plugins step).
- d924a73: TUI: multi-session switcher (`/sessions`).

  - New `/sessions` slash command (alias `/switch`) opens a `ListPicker` overlay
    listing your saved conversations — first-prompt title, last-active time, event
    count and active model — sourced from the same `~/.moxxy/sessions` index the
    desktop sidebar and `moxxy resume` already read. The session you're in is
    marked, and a leading **+ New session** entry starts a fresh conversation.
  - Picking an entry re-points the TUI onto that session in place: the live session
    is torn down (firing its `onShutdown` hooks and releasing the runner socket),
    the chosen session is booted (resuming its persisted history, or a fresh one),
    and the chat view re-mounts onto it. Your previous conversation stays saved, so
    you can switch back and forth.
  - Works when the TUI hosts the session (the default self-host / `--standalone`
    modes). When attached to an external `moxxy serve` (whose runner owns a single
    fixed session) the switcher degrades to a notice pointing at `moxxy resume`.

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/core@0.21.0
  - @moxxy/config@0.21.0
  - @moxxy/chat-model@0.3.9
  - @moxxy/plugin-mcp@0.0.32

## 0.3.15

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
  - @moxxy/chat-model@0.3.8
  - @moxxy/plugin-mcp@0.0.31

## 0.3.14

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/core@0.6.3
  - @moxxy/chat-model@0.3.7
  - @moxxy/plugin-mcp@0.0.30

## 0.3.13

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/chat-model@0.3.6
  - @moxxy/core@0.6.2
  - @moxxy/plugin-mcp@0.0.29

## 0.3.12

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/chat-model@0.3.5
  - @moxxy/core@0.6.1
  - @moxxy/plugin-mcp@0.0.28

## 0.3.11

### Patch Changes

- Updated dependencies [3862cb2]
  - @moxxy/core@0.6.0

## 0.3.10

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/chat-model@0.3.4
  - @moxxy/core@0.5.4
  - @moxxy/plugin-mcp@0.0.27

## 0.3.9

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/chat-model@0.3.3
  - @moxxy/core@0.5.3
  - @moxxy/plugin-mcp@0.0.26

## 0.3.8

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/chat-model@0.3.2
  - @moxxy/core@0.5.2
  - @moxxy/plugin-mcp@0.0.25

## 0.3.7

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/chat-model@0.3.1
  - @moxxy/core@0.5.1
  - @moxxy/plugin-mcp@0.0.24

## 0.3.6

### Patch Changes

- Updated dependencies [917a700]
  - @moxxy/chat-model@0.3.0

## 0.3.5

### Patch Changes

- Updated dependencies [4bdd6f8]
  - @moxxy/core@0.5.0

## 0.3.4

### Patch Changes

- Updated dependencies [0870222]
  - @moxxy/core@0.4.0

## 0.3.3

### Patch Changes

- Updated dependencies [6c48c28]
  - @moxxy/core@0.3.0

## 0.3.2

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/chat-model@0.2.4
  - @moxxy/core@0.2.9
  - @moxxy/plugin-mcp@0.0.23

## 0.3.1

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/chat-model@0.2.3
  - @moxxy/core@0.2.8
  - @moxxy/plugin-mcp@0.0.22

## 0.3.0

### Minor Changes

- f8b0c63: feat(collaborative): launch collaborations from the Collaborate tab; one at a time

  Collaboration is no longer started as a chat mode (any chat in a workspace could
  have kicked one off, clobbering the same repo's worktrees). It is launched from
  the Collaborate tab, and only ONE runs at a time across the app to save
  resources.

  - **Global single-flight lock** (`~/.moxxy/collab/active.lock`, cross-process,
    with dead-pid reclaim): the coordinator acquires it before a run and refuses a
    second with a clear message; released in `finally`.
  - **Collaborate tab Start composer** — type a goal → it sets the active
    workspace's session to collaborative mode and runs it; a `＋ New` affordance
    after a run finishes. A new read-only `collab.active` IPC lets the tab disable
    Start (with a notice) while a collaboration runs in any workspace.
  - **Removed from the chat mode pickers** — `collaborative` and the internal
    `collab-architect`/`collab-peer` modes no longer appear in the desktop
    AgentPicker or the TUI `/mode` picker; `/mode collab*` points to `/collab`.
  - chat-model: a refused start no longer leaves an empty collaboration block.

### Patch Changes

- Updated dependencies [f8b0c63]
  - @moxxy/chat-model@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [897a1fc]
- Updated dependencies [897a1fc]
  - @moxxy/plugin-mcp@0.0.21
  - @moxxy/sdk@0.14.4
  - @moxxy/chat-model@0.2.1
  - @moxxy/core@0.2.7

## 0.2.0

### Minor Changes

- 27bfaf6: feat(collaborative): agentic collaborative mode — a team of separate agents working in parallel

  A new selectable `collaborative` mode runs a _team_ of full, **separate** agent
  runner processes on one task (instead of in-process subagents). An **architect**
  agent designs the plan + shared **contracts** and proposes the roster (you
  approve/adjust); **implementer** agents then build in parallel, each in its own
  git **worktree**, coordinating over a new cross-process **collaboration hub**:

  - **`@moxxy/plugin-collab`** — the hub: a unix-socket message bus, a task board
    that doubles as an exclusive **file-lock** arbiter, a **contract registry**
    (publish → propose-change → ack → commit), **peer-read** (one agent reads
    another's in-progress files), crash detection, and **human step-in**
    (pause / resume / directive) — plus the peer `collab_*` tools and the
    `/collab_say` `/collab_direct` `/collab_pause` `/collab_resume` commands.
  - **`@moxxy/mode-collaborative`** — the coordinator (`collaborative`) + the
    internal `collab-architect` / `collab-peer` modes, the peer-process supervisor,
    the git worktree + **staged, ownership-resolved merge** engine (the user's
    branch is only advanced on a clean, atomic promote; conflicts never leave
    markers), and a user-configurable `CollabConfig`. Falls back to a **sequential
    single-workspace** run when git is unavailable (e.g. desktop users without git).
  - **`moxxy agent`** — an internal headless peer-runner subcommand.
  - **UI** — a folded `CollaborationBlock` in `@moxxy/chat-model`; an inline
    team-summary card in chat; and a dedicated **Collaborate** desktop workspace
    (agents · tasks · contracts rail, a `# All` / `@agent` channel selector, and a
    step-in composer) plus a compact TUI `collab` view.

  No runner-protocol bump (the hub has its own versioned protocol; collaboration
  events ride the existing `plugin_event` stream).

### Patch Changes

- Updated dependencies [27bfaf6]
  - @moxxy/chat-model@0.2.0

## 0.1.13

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3
  - @moxxy/chat-model@0.1.5
  - @moxxy/core@0.2.6
  - @moxxy/plugin-mcp@0.0.20

## 0.1.12

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2
  - @moxxy/chat-model@0.1.4
  - @moxxy/core@0.2.5
  - @moxxy/plugin-mcp@0.0.19

## 0.1.11

### Patch Changes

- 640d036: perf(chat-model): incrementalize the per-turn block fold (kill the O(n²)/turn re-fold)

  Both the desktop Transcript and the TUI ChatView re-folded the ENTIRE growing
  event array via `pairToolEvents` on every committed event — k full O(n) walks
  per turn, degrading to O(n²) over a session. The fold body is now lifted into a
  reusable `stepFold(state, event)` (the verbatim old loop body) shared by the
  batch `pairToolEvents` and a new `IncrementalFold` that keeps the folded block
  tree alive across renders and re-folds only the unsettled tail past a
  `(version, prefixLength)` high-water mark. `syncTo` extends the prefix on a pure
  append and rebuilds only when it shifts (scroll-up prepend, /clear). A golden
  test feeds many recorded sequences (skill scopes, live tools, subagents, orphan
  results, reasoning, file diffs) one event at a time and asserts the incremental
  tree is byte-identical to `pairToolEvents(fullPrefix)` after EVERY event, plus a
  counter assertion that a k-event turn does O(k) — not O(k²) — step work.

  Also: the TUI settled-prefix scan resumes from its high-water mark instead of
  re-walking from index 0; `WorkflowCanvas` memoizes `topoOrder` on a geometry-free
  topology signature so a node drag no longer recomputes the O(V+E) fold per
  mousemove; and `usage.perCall` is head-capped at 200 entries (lossless for the
  meter — totals still fold every call).

- Updated dependencies [640d036]
- Updated dependencies [640d036]
  - @moxxy/chat-model@0.1.3
  - @moxxy/sdk@0.14.1
  - @moxxy/core@0.2.4
  - @moxxy/plugin-mcp@0.0.18

## 0.1.10

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0
  - @moxxy/core@0.2.3
  - @moxxy/chat-model@0.1.2
  - @moxxy/plugin-mcp@0.0.17

## 0.1.9

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0
  - @moxxy/chat-model@0.1.1
  - @moxxy/core@0.2.2
  - @moxxy/plugin-mcp@0.0.16

## 0.1.8

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
  - @moxxy/chat-model@0.1.0
  - @moxxy/core@0.2.1
  - @moxxy/plugin-mcp@0.0.15

## 0.1.7

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0
  - @moxxy/core@0.2.0
  - @moxxy/chat-model@0.0.14
  - @moxxy/plugin-mcp@0.0.14

## 0.1.6

### Patch Changes

- Updated dependencies [4c594d8]
  - @moxxy/core@0.1.0

## 0.1.5

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0
  - @moxxy/chat-model@0.0.13
  - @moxxy/core@0.0.13
  - @moxxy/plugin-mcp@0.0.13

## 0.1.4

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0
  - @moxxy/core@0.0.12
  - @moxxy/chat-model@0.0.12
  - @moxxy/plugin-mcp@0.0.12

## 0.1.3

### Patch Changes

- cf2f651: Performance pack from the 2026-06-09 audit (A39–A42 + A42b): the TUI context meter caches its token estimate per log and folds in only new events instead of re-walking the entire event log (incl. JSON.stringify of every tool result) on every ~30Hz render; the desktop NDJSON chat log keeps a size/mtime-guarded line-offset index so scroll-up pages seek-read only their own byte range instead of re-reading and re-parsing the whole file per page; MemoryStore maintains its MEMORY.md index incrementally (no more O(N) re-read of every memory file per write) and gains a warn-only `maxMemories` soft cap (default 500 — no eviction, memories are user knowledge); goal mode declares its idle nudge as a volatile tail message and the stable-prefix cache strategy places its rolling tail breakpoint before volatile messages, so idle goal iterations re-read the cached prefix instead of paying a guaranteed-wasted cache write; and compactor-summarize now produces a real summary via the session's own provider/model (new optional `provider`/`model` on `CompactContext`), falls back to an honest, clearly-labeled head+tail digest when no provider is reachable, and reports `tokensSaved` from real character deltas instead of the fabricated `slice.length * 30`.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1
  - @moxxy/core@0.0.11
  - @moxxy/plugin-mcp@0.0.11
  - @moxxy/chat-model@0.0.11

## 0.1.2

### Patch Changes

- f3c798f: `/new` now truly resets the session everywhere (audit A10). New `session.reset` runner RPC (protocol v3) + optional `SessionLike.reset()` capability: the runner aborts in-flight turns and clears its authoritative event log; the log's new `EventLog.onClear` listeners broadcast a `session.reset` notification so every attached mirror clears in lockstep (re-arming seq-0 ingest instead of silently rejecting all further events) and truncate the persisted session JSONL so wiped history can't resurrect on `--resume` — fixing the same resurrection bug for local `/new`. The TUI and Telegram `/new` paths call `reset()` (falling back to `log.clear()` when the capability is absent) and report an error instead of claiming "history cleared" when the reset RPC fails.
- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/core@0.0.10
  - @moxxy/sdk@0.8.0
  - @moxxy/chat-model@0.0.10
  - @moxxy/plugin-mcp@0.0.10

## 0.1.1

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0
  - @moxxy/chat-model@0.0.9
  - @moxxy/core@0.0.9
  - @moxxy/plugin-mcp@0.0.9

## 0.1.0

### Minor Changes

- fab0fb4: Update flows: a real `moxxy update`, a TUI "new version" nudge, and observable desktop self-update.

  - **CLI** — new `moxxy update` command: checks the npm registry, detects how the
    CLI was installed (npm/pnpm/yarn/bun, global or local), and runs the matching
    upgrade after a confirm. `--check`/`--dry-run` report-only, `--yes` to skip the
    prompt. Source checkouts get git advice instead of an install.
  - **TUI** — surfaces a newer published `@moxxy/cli` as a one-line, auto-dismissing
    banner and shows the running version in the status line. The check is cached
    (~12h) and fully non-blocking on startup. (Also fixes the `version` prop being
    dropped before it reached the view.)
  - **Desktop self-update** — the previously-silent fall-back-to-the-floor is now
    observable: a persistent boot-decision log under `<userData>/app/boot-log.json`,
    a reason for every gate that rejects a staged bundle, and a Settings → Dashboard
    → Diagnostics readout. The renderer's boot confirmation is hardened (retry +
    reported failure) so a flaky heartbeat can't make the boot-probe revert a
    healthy update. Adds the `app.updateDiagnostics` / `app.bootHeartbeatFailed` IPC.

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0
  - @moxxy/chat-model@0.0.8
  - @moxxy/core@0.0.8
  - @moxxy/plugin-mcp@0.0.8

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1
  - @moxxy/chat-model@0.0.7
  - @moxxy/core@0.0.7
  - @moxxy/plugin-mcp@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0
  - @moxxy/chat-model@0.0.6
  - @moxxy/core@0.0.6
  - @moxxy/plugin-mcp@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0
  - @moxxy/chat-model@0.0.5
  - @moxxy/core@0.0.5
  - @moxxy/plugin-mcp@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0
  - @moxxy/chat-model@0.0.4
  - @moxxy/core@0.0.4
  - @moxxy/plugin-mcp@0.0.4

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0
  - @moxxy/chat-model@0.0.3
  - @moxxy/core@0.0.3
  - @moxxy/plugin-mcp@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3
  - @moxxy/chat-model@0.0.2
  - @moxxy/core@0.0.2
  - @moxxy/plugin-mcp@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
  - @moxxy/core@0.0.1
  - @moxxy/plugin-mcp@0.0.1
