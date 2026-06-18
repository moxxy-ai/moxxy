# @moxxy/mode-collaborative

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
