# @moxxy/plugin-cli

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
