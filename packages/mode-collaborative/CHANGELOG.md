# @moxxy/mode-collaborative

## 0.7.11

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/plugin-collab@0.3.11
- @moxxy/runner@0.2.24

## 0.7.10

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/plugin-collab@0.3.10
  - @moxxy/runner@0.2.23

## 0.7.9

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/plugin-collab@0.3.9
  - @moxxy/runner@0.2.22

## 0.7.8

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/plugin-collab@0.3.8
  - @moxxy/runner@0.2.21

## 0.7.7

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/plugin-collab@0.3.7
  - @moxxy/runner@0.2.20

## 0.7.6

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/plugin-collab@0.3.6
  - @moxxy/runner@0.2.19

## 0.7.5

### Patch Changes

- @moxxy/runner@0.2.18
- @moxxy/plugin-collab@0.3.5

## 0.7.4

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/plugin-collab@0.3.4
  - @moxxy/runner@0.2.17

## 0.7.3

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/plugin-collab@0.3.3
  - @moxxy/runner@0.2.16

## 0.7.2

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/plugin-collab@0.3.2
  - @moxxy/runner@0.2.15

## 0.7.1

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/plugin-collab@0.3.1
  - @moxxy/runner@0.2.14

## 0.7.0

### Minor Changes

- 0daee68: feat(collaborative): git-first execution with a parallel lock-coordinated fallback (invisible)

  The non-git path ran agents ONE AT A TIME (sequential) — slow, and it's why "the
  team doesn't respond" when a user runs in a plain folder (only one agent is ever
  live). Now the engine is git-first and always parallel, and picks the safest
  mechanism underneath without any user-facing jargon:

  - **Already a git repo** → worktrees + a clean, conflict-aware merge (unchanged).
  - **Plain folder** → we quietly `git init` + snapshot it, so it STILL gets full
    worktree isolation + merge. Most "plain folder" runs now go fully parallel.
  - **Git genuinely unavailable** (not installed, or init/commit throws) → agents
    run in PARALLEL in the shared workspace, coordinated by the file-lock board
    (claim-before-edit). ownedPaths are pre-seeded as locks; an overlap is surfaced.
  - **`concurrency: 'sequential'`** remains as the explicit one-at-a-time fallback.

  Safety (from adversarial review): the shared-workspace prompt is hardened —
  claim before EVERY edit, narrowest paths, claim both old+new on rename, one owner
  for shared/aggregator files, only rely on a teammate's released work; the
  architect is required to hand out DISJOINT ownedPaths. peer-read on the shared
  tree reuses the path-traversal guard.

  Tests: auto-init → git-parallel; forced no-git → cwd-parallel (not sequential, no
  git repo); explicit sequential; cwd-parallel pre-seed + overlap surfacing.

## 0.6.0

### Minor Changes

- f50a306: feat(collaborative): coordinator-authored role charters (proper, task-suited roles)

  Every peer ran the SAME generic prompt and only a role LABEL was injected — so a
  "designer" and a "developer" behaved identically. Now the ARCHITECT authors, per
  roster agent, a tailored CHARTER (persona + responsibilities + quality bar +
  collaboration + definition-of-done) suited to THIS task, and each peer runs with
  that charter as part of its system prompt — proper roles created for the task,
  not pre-configured.

  - RosterEntry gains an optional `charter`; the architect prompt asks for a 4-8
    sentence charter per agent.
  - The charter is written to the run dir (NOT the workspace/worktree, so it's
    never committed), passed to the peer by PATH via a new `MOXXY_COLLAB_CHARTER_FILE`
    env (never the body), and read at boot into the STATIC system-prompt prefix
    (cached once, not re-billed per turn).
  - Safety: the charter is LLM-authored, so it is sanitised (NUL-stripped, capped
    at 2000 chars) and APPENDED after the authoritative shared rules (never the
    sole prompt); the roster-approval dialog shows a clipped charter preview — the
    human gate on injected system-prompt text.

  Tests: charter carried + capped + written outside the committed tree + passed to
  the peer; peerPromptWithCharter appends-not-replaces; architect prompt asks for a
  charter.

### Patch Changes

- Updated dependencies [f50a306]
  - @moxxy/plugin-collab@0.3.0

## 0.5.0

### Minor Changes

- d71bf6f: feat(collaborative): brief is a SUMMARY, not the transcript — with on-demand recall

  The brief dumped up to ~6KB of the raw conversation into BRIEF.md, and every one
  of the N spawned agents was told to read it — so each peer re-ingested the whole
  dialogue. Now:

  - **BRIEF.md is a concise summary** — the goal + key requirements/constraints/
    decisions — produced by a single coordinator-side LLM call (`summarize.ts`,
    a direct off-log `provider.stream`, mirroring the summarize-compactor) with a
    deterministic **heuristic fallback** when no provider is available, so a brief
    never sinks the run.
  - **The full conversation goes to `.moxxy-collab/CONVERSATION.md`** for ON-DEMAND
    recall — never auto-loaded into any agent's context. The prompts tell agents to
    read or grep it only when they need a detail the summary omits.

  Net: peers get the intent cheaply instead of paying for the transcript N times.
  Adds summarizer (provider/model guard, error/empty → null), brief, and prompt
  tests; the e2e run now asserts CONVERSATION.md is written.

## 0.4.1

### Patch Changes

- acc676c: fix(collaborative): agents reply to the human instead of going silent

  Stepping into a running collaboration felt one-way: a human directive or direct
  message reached a live agent (via the awareness nudge), but agents only ever
  broadcast progress to the team — they never addressed the human back, so it
  looked like "the team doesn't respond". The shared prompt now tells every agent
  to treat a human directive/message as authoritative AND reply to them with
  `collab_send` to "human" — acknowledge it and say what they'll do (or ask a brief
  clarifying question). Adds prompt-content regression tests (brief pointer +
  memory recall/save + the human-reply rule + cross-functional roster guidance).

## 0.4.0

### Minor Changes

- f070207: feat(collaborative): run archive/history + an always-available "End & archive"

  Two gaps the user hit: a wedged/finished collaboration couldn't be ended (the
  "＋ New" button only appeared once a run had completed, so a stuck run — or a
  stale single-flight lock — left the Collaborate tab with no way forward), and
  there was no record of past runs at all (the transient run dirs were even left
  orphaned).

  - **Run archive.** Every run is now persisted as a JSON record under
    `~/.moxxy/collab/runs/<runId>.json` on EVERY exit path (completed, aborted,
    failed) — task, brief, roster + per-agent status/summaries, board, contracts,
    merge result, and timings. New `@moxxy/mode-collaborative` archive API
    (`listRunRecords` / `readRunRecord` / `writeRunRecord`).
  - **End & archive.** New `collab.end` IPC aborts the coordinator turn (its
    finally tears the team down + archives) and force-releases the global lock —
    so a stuck run or a stale lock can always be cleared. New
    `forceReleaseCollabLock()` + `SessionDriver.abortActiveTurns()`.
  - **History view.** New `collab.history` IPC + a Collaborate-tab History list
    (outcome, task, agent counts, per-run detail with brief + summaries).
  - The Collaborate header now always offers **End & archive** (while running or
    while a lock is held) and the "already running" banner gained an inline
    "end & archive it now" so a wedged run never blocks a fresh start.

  Adds archive + force-release + abort tests, and the coordinator e2e test now
  asserts the run is archived.

- b226696: feat(collaborative): dynamic, cross-functional roles (not a pool of identical implementers)

  The roster could only ever be `architect | implementer`, and `readRoster`
  force-overwrote every proposed role to `'implementer'` — so the architect's
  team was always a flat pool of clones, the opposite of the "a PM, a designer,
  some developers, a QA, a writer" vision.

  - `AgentRole` is now open (`'architect'` stays reserved for the coordinator's
    planner; any other label is a free-form team function).
  - `readRoster` carries the architect's proposed `role` (sanitised; a proposed
    `'architect'` is coerced to `'implementer'` since that's reserved) instead of
    hardcoding `'implementer'`.
  - The architect prompt now tells it to assemble the RIGHT team for the
    deliverable (developer/designer/pm/qa/writer/researcher/editor/…), not to
    default everyone to "implementer". The peer prompt + seeded turn now lead with
    the agent's role so a writer writes, a designer designs, a QA reviews.

  Roles flow straight into the existing roster/archive/UI, which already render
  `role`. Adds tests that proposed roles are carried and the reserved role coerced.

### Patch Changes

- Updated dependencies [b226696]
  - @moxxy/plugin-collab@0.2.0

## 0.3.0

### Minor Changes

- 8bc25e7: feat(collaborative): give every agent the whole goal + the conversation, not just its subtask

  Spawned agents booted fresh sessions seeded with only their one-line subtask, so
  they never saw the overall goal or the dialogue that produced it — and the
  `MOXXY_COLLAB_PARENT_TASK` env the coordinator already set was read nowhere.

  - The coordinator now distils the user's conversation into a compact, token-
    capped **`.moxxy-collab/BRIEF.md`** (goal + recent intent) and writes it into
    the scaffold before the architect runs, so it's committed into every worktree
    (parallel) or present in the shared dir (sequential) — the whole team inherits
    the real intent.
  - `moxxy agent` now reads `MOXXY_COLLAB_PARENT_TASK` and seeds each implementer's
    first turn with the overall goal + its sub-task + a pointer to the brief and
    contracts (the architect, whose sub-task already is the goal, just gets the
    pointer).
  - The shared agent prompt now tells every agent to read the brief first and to
    `recall()` prior knowledge + `memory_save` durable facts — so the team builds
    memory/recall for the larger work.

  The brief is a pure, unit-tested digest (most-recent turns, clipped, total-
  capped) so a long conversation still yields a small file.

## 0.2.6

### Patch Changes

- a2cb758: fix(collaborative): stop the 30-minute hang, the spawn crash, and worktree leaks

  Agentic-collaborative mode could freeze for the full wall-clock (30 min) or take
  down the whole runner. Three root causes, fixed:

  - **30-minute hang.** A spawned agent only reported a terminal hub status when it
    called `collab_done`. Every other way a turn can end (provider error, iteration
    cap, idle, stuck-loop) left the process idling as `connected`, so the
    coordinator polled the full wall-clock before giving up. Peers now report a new
    terminal `failed` status when their turn ends without `collab_done`, and the
    coordinator adds a short **boot deadline** plus reacts to an observed child
    exit — so failures surface in seconds, not after 30 minutes.
  - **Coordinator crash on a bad spawn.** The peer `spawn()` had no `'error'`
    listener, so a failed spawn became an uncaught exception. It is now captured as
    a normal exit + diagnostic.
  - **Leaks.** Worktrees and the run's socket dir are now cleaned up on every exit
    path (abort, 0-done, conflict), not just integrate()'s happy path. The
    sequential fallback now awaits a peer's real exit before starting the next, so
    two agents never edit the shared workspace at once.

  A `failed` agent also releases its file locks (like a crash), and agents now
  self-report `working` while a turn is in flight. Adds a deterministic
  fail-fast coordinator test and a real-process integration test that spawns the
  actual `moxxy agent` binary and asserts it registers and reports a terminal
  status (no LLM required).

- Updated dependencies [a2cb758]
  - @moxxy/plugin-collab@0.1.7

## 0.2.5

### Patch Changes

- @moxxy/runner@0.2.13
- @moxxy/plugin-collab@0.1.6

## 0.2.4

### Patch Changes

- Updated dependencies [0870222]
  - @moxxy/runner@0.2.12
  - @moxxy/plugin-collab@0.1.5

## 0.2.3

### Patch Changes

- @moxxy/runner@0.2.11
- @moxxy/plugin-collab@0.1.4

## 0.2.2

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/plugin-collab@0.1.3
  - @moxxy/runner@0.2.10

## 0.2.1

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/plugin-collab@0.1.2
  - @moxxy/runner@0.2.9

## 0.2.0

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

## 0.1.1

### Patch Changes

- Updated dependencies [897a1fc]
- Updated dependencies [897a1fc]
  - @moxxy/runner@0.2.8
  - @moxxy/sdk@0.14.4
  - @moxxy/plugin-collab@0.1.1

## 0.1.0

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
  - @moxxy/plugin-collab@0.1.0
