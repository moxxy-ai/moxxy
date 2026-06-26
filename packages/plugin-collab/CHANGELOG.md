# @moxxy/plugin-collab

## 0.3.14

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/runner@0.2.27

## 0.3.13

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/runner@0.2.26

## 0.3.12

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/runner@0.2.25

## 0.3.11

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/runner@0.2.24

## 0.3.10

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/runner@0.2.23

## 0.3.9

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/runner@0.2.22

## 0.3.8

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/runner@0.2.21

## 0.3.7

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/runner@0.2.20

## 0.3.6

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/runner@0.2.19

## 0.3.5

### Patch Changes

- @moxxy/runner@0.2.18

## 0.3.4

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/runner@0.2.17

## 0.3.3

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
  - @moxxy/runner@0.2.16

## 0.3.2

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2
  - @moxxy/runner@0.2.15

## 0.3.1

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1
  - @moxxy/runner@0.2.14

## 0.3.0

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

## 0.2.0

### Minor Changes

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

## 0.1.7

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

## 0.1.6

### Patch Changes

- @moxxy/runner@0.2.13

## 0.1.5

### Patch Changes

- Updated dependencies [0870222]
  - @moxxy/runner@0.2.12

## 0.1.4

### Patch Changes

- @moxxy/runner@0.2.11

## 0.1.3

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0
  - @moxxy/runner@0.2.10

## 0.1.2

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5
  - @moxxy/runner@0.2.9

## 0.1.1

### Patch Changes

- Updated dependencies [897a1fc]
- Updated dependencies [897a1fc]
  - @moxxy/runner@0.2.8
  - @moxxy/sdk@0.14.4

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
