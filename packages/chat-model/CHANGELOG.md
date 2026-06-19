# @moxxy/chat-model

## 0.3.1

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.3.0

### Minor Changes

- 917a700: feat(desktop): redesign the Collaborate feed + task details, deliverables, message cards

  The Collaborate tab showed the team's messages as flat monospace rows
  (`agent → all · subject: body`) and gave no way to inspect a task or see what
  the run produced. Redesigned for observability:

  - **Message cards.** Each message is now a card with a coloured author chip
    (human vs agent), a kind chip derived from the subject (kickoff / progress /
    done / blocked / directive), a broadcast-vs-DM tag (`📣 all` vs `→ agent`), a
    timestamp, and the body — so a long run reads like a team channel, and direct
    messages are visually distinct from broadcasts.
  - **Tasks → modal.** Task-board rows are clickable and open a modal with status,
    owner, detail, and the files the item covers.
  - **Deliverables.** A new rail section lists the distinct files the team
    claimed/produced; the task view (`CollabTaskView`) now folds `paths` + `detail`
    from the board stream.

  Adds folding-test coverage for the new task fields.

## 0.2.4

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.2.3

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.2.2

### Patch Changes

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

## 0.2.1

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

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

## 0.1.5

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.1.4

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.1.3

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
  - @moxxy/sdk@0.14.1

## 0.1.2

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.1.1

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.1.0

### Minor Changes

- 951f374: Make the model's reasoning visible, and redesign sub-agents as a collapsible group.

  **Reasoning preview (per-provider, Codex-style between calls).** When enabled, the model's
  thinking now streams live (replacing the silent "thinking…" dots) and is kept as a dim,
  collapsible "Thinking" block interleaved with the tool calls it precedes — so you can see what
  the model is doing instead of waiting out a multi-second pause. Because reasoning is finalized
  once per provider round, summaries land naturally between tool batches.

  It's gated per provider/model via a new `ModelDescriptor.supportsReasoning` capability and turned
  on with `config.context.reasoning` (`true`, or `{ effort: 'low' | 'medium' | 'high' }`):

  - **Anthropic / Claude Code** — adaptive thinking with summarized display; the signed thinking
    block round-trips so interleaved-thinking tool-use continuations stay valid.
  - **OpenAI Codex** — surfaces the reasoning summary it already requests (previously discarded).
  - **OpenAI** — `reasoning_effort` for the gpt-5 family plus the `reasoning_content` summary that
    OpenAI-compatible reasoning backends stream.

  New SDK surface: a `reasoning` `ContentBlock`, `reasoning_delta`/`reasoning_signature`
  `ProviderEvent`s, `reasoning_chunk`/`reasoning_message` events, a `ProviderRequest.reasoning`
  knob, and `ModelDescriptor.supportsReasoning`. No runner protocol bump — reasoning events ride
  the existing event channel.

  **Grouped sub-agents view.** A `dispatch_agent` fan-out now renders as one collapsible group —
  a header (`N Explore agents finished`) over a tree of per-agent rows showing each agent's tool-use
  count, **token usage**, and status — instead of one block per child. Per-agent token totals and the
  agent kind are forwarded on the `subagent_*` events; both the desktop and TUI render the new tree.

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

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.0.12

### Patch Changes

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.0.11

### Patch Changes

- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.0.10

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

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
