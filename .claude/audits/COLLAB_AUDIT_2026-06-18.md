# Agentic-Collaborative Mode — Audit & Roadmap (2026-06-18)

Scope: `@moxxy/mode-collaborative` + `@moxxy/plugin-collab` (coordinator, peer loop,
hub, state, worktrees, integrate) and the desktop `Collaborate` surface. Branch
`worktree-collab-audit-fix` off `main`@#272 (collab is merged + #243-hardened).

Method: 5-lane parallel audit (work-breaking · context-access · performance/tokens ·
security · feasibility/vision), each finding adversarially re-verified against the
code (refute-by-default). **50 findings: 3 critical, 16 high, 18 medium, 13 low.
All 19 critical+high survived verification** (one critical → medium for overstated
wording). Plus a zero-LLM runtime probe proving the spawn/socket/register path works.
Raw data: `collab-audit-2026-06-18.raw.json`.

---

## TL;DR

The core plumbing is sound — a real spawned `moxxy agent` boots, connects to the hub
socket, and registers (verified by probe). What's broken is **everything around the
edges of the happy path**, and the product is **a much narrower thing than the
vision**.

The user's three asks map cleanly onto the findings:

1. **"Make it work" →** one critical hang + two high crashers/leaks dominate the
   "seems broken" experience.
2. **"Agents need the whole workspace + the messages, to build memory/recall" →** a
   confirmed, by-design context-starvation gap. Files are OK (worktree); **intent and
   conversation are entirely lost**, and `MOXXY_COLLAB_PARENT_TASK` is dead code.
3. **"A dynamic-role company that delivers the end result, token-efficiently" →** the
   model is structurally a *fixed two-role, flat-parallel, git-file-merge pipeline*.
   Real value today exists only for "an existing git repo + a feature that splits into
   disjoint files" — the **opposite** of the non-expert / any-deliverable target.

---

## 1. Make it work — the "seems broken" cluster

| # | Sev | Finding | Why it reads as "broken" |
|---|-----|---------|--------------------------|
| 1 | **CRIT** | `agent-exit-no-terminal-status-30min-hang` | A peer only reports a terminal status when it calls `collab_done`. **Every other exit** (provider error, iteration cap, idle, stuck-loop, missing key) returns from the loop but the process **keeps idling** (`runUntilSignal` blocks forever), so the socket never drops → hub never marks it `crashed` → the coordinator polls the full **30-minute** wall-clock. One bad peer freezes the whole run. |
| 2 | HIGH | `spawn-error-unhandled-crashes-coordinator` | `spawn()` has **no `'error'` listener**. A failed spawn (bad path, ENOENT — plausible under Electron) emits `'error'`, which with no handler becomes an **uncaught exception that crashes the coordinator/runner**. Likely the hard-failure users hit. |
| 3 | HIGH | `wallclock-30min-idle-burn` / `failure-modes-look-like-30min-hang` | No short *boot deadline*: if a peer never reaches `connected`, the coordinator still waits `wallClockMs`. Failures are indistinguishable from work. |
| 4 | HIGH | `worktree-branch-leak-on-non-happy-path` | Worktrees/branches are cleaned only inside `integrate()`'s happy path → they leak on 0-done, abort, conflict, or integrate failure. (Confirmed: today's `~/.moxxy/collab/` has orphaned empty run dirs.) |
| 5 | HIGH | `architect-cannot-broker-after-collab-done` | The architect *must* call `collab_done` to unblock the coordinator, but that **terminates its loop** — so the prompt's promise that it "stays available as the BROKER" is **structurally impossible**. Contract-change acks from the architect can never arrive → an implementer that proposes a change waits forever. |
| 6 | HIGH | `real-process-path-completely-untested` | The only e2e test **fakes the supervisor**; the real spawn/env/register/crash/hang/conflict paths have **zero coverage**. |

Plus medium: `sequential-fallback-overlapping-processes` (next agent spawns before
prev exits — two writers in the shared dir), `peer-max-iterations-config-dead`,
`verifygate-config-unused`, `roster-approval-fails-open-without-resolver`,
`peerreader-diff-captures-prescaffold-base`, `stepin-wrong-workspace-no-hub`.

## 2. Context access (the user's #1 ask)

**Files: OK.** Git-mode peers get a worktree at `baseSha`, which includes tracked +
*untracked* + dirty files (`git add -A` snapshot). **Caveat:** `.gitignore`d files
(`.env`, local config, build state) are invisible in worktrees, with no warning
(`gitignored-files-invisible-in-worktrees`).

**Intent & messages: lost by design.** Each peer boots a **brand-new empty Session**
(`<coord>::<agent>`, sticky not resumed) seeded with a **single string** — for
implementers, their narrow `subtask`. Confirmed gaps:
- `parent-task-set-but-never-read` — `MOXXY_COLLAB_PARENT_TASK` is *written* into every
  peer's env and **read nowhere**. Implementers never see the overall goal.
- `peers-lose-user-conversation` — the user's dialogue, clarifications, and constraints
  never reach any agent; even the architect gets only `lastUserPromptText` (the last
  message, not the conversation).
- `architect-exploration-discarded` — the architect explores the repo, then everything
  except `CONTRACTS.md` is thrown away; **every peer re-explores from scratch** (also a
  major token cost).
- `no-memory-recall-nudge-or-scoped-write` — memory *is* global+shared
  (`~/.moxxy/memory`, inherited `MOXXY_HOME`), but **neither prompt mentions recall or
  save**, there's no collab-scoped tag, and no distilled brief is written into the
  scaffold. Agents can't build good memory/recall for the larger work.

**Fix shape (implemented in this PR — see §6):** coordinator distills the conversation
into a compact `.moxxy-collab/BRIEF.md` (overall goal + intent digest), committed into
the scaffold so every worktree inherits it and it's archived; revive `PARENT_TASK` as a
turn preamble; prompt agents to read the brief + recall/save memories.

## 3. Performance & token efficiency

Structurally inefficient: up to **6 fully-independent fresh Sessions** (1 architect +
≤5 peers), each its own OS process with its own prompt cache, each **re-exploring the
same codebase** (the architect already paid for that map). No cross-peer cache sharing;
the awareness nudge is re-fetched + re-projected **every iteration**; `collab_peer_diff`
can inject a **64MB** diff into a peer's context unbounded (`peer-diff-unbounded-injection`).
Rough estimate from the lane: **3–5× the tokens** a well-briefed single agent would
spend, dominated by redundant exploration. Highest-leverage reductions: share the
architect's exploration as a committed `WORKSPACE`/`BRIEF` (kills re-exploration),
seed contracts/roster into the cached system prefix instead of per-peer tool
round-trips, cap `peer_diff`, throttle awareness to hub-signaled activity, and
right-size models per role.

## 4. Security

The **#243 hardening holds**: peer-read traversal is segment-aware (`resolveWithin`),
claim/release/board-id ownership is owner-checked, dead-agent locks are freed, sockets
sit under `0700` dirs with `0600` nodes, and auto-approve still consults the user's
deny policy (`~/.moxxy/permissions.json`) — invariant #6 preserved. Trust boundary is
"same local user." Remaining gaps within it:
- `architect-runs-before-approval-gate` (HIGH) — the architect runs a **full
  auto-approved turn (bash/write/fetch) in the user's real repo BEFORE** the roster
  gate; the gate also **fails open** when no approval resolver is installed.
- `hub-register-identity-spoof` (HIGH) — `collab.register` accepts any roster id with no
  binding to the connection; a misbehaving peer can register *as another agent* (incl.
  the architect). Weaker than the hub's own docstring claims.
- Medium/low: `peer-read-symlink-escape` (lexical guard doesn't stop symlinks),
  `scaffold-wip-commits-mutate-user-branch` (history rewrite via real commits +
  `--no-verify`), `full-env-provider-keys-to-children`, `peer-runner-socket-unauthenticated`,
  `windows-child-leak-detached-false`.

## 5. Feasibility & business value vs the vision

The vision: a dynamically-assembled **company of fluid roles** (PM/designer/writer/QA/
dev/architect) that takes a non-expert's vague prompt and delivers a finished
**end-result of any kind**. The shipped code:
- **Cannot express roles** — `AgentRole = 'architect' | 'implementer'` (closed union),
  and `readRoster` **force-overwrites every proposed role to `'implementer'`**
  (`roles-cannot-exist-fixed-two-role-pipeline`, CRIT).
- **Assumes git + disjoint file ownership** — isolation = git worktree, integration =
  file merge by claim-ownership. Doesn't fit docs/designs/plans/research or non-file
  roles (`git-file-ownership-excludes-non-code-deliverables`).
- **No requirements elicitation** — a vague prompt goes straight to decomposition.
- **Flat parallel, no dependency DAG** — the architect must pretend subtasks are
  independent; no design→build→QA sequencing.
- **No QA/review gate, no iteration loop, no PM verification** — `verifyGate` is dead
  config; one pass and done; nobody checks the result against intent.

**Genuine value today** is narrow: an existing git repo + a feature that splits cleanly
into disjoint files. That's the opposite of the target user.

---

## 6. What this PR changes (Wave 1 — "make it work" + context + archive)

Implemented + tested:
- **Hang/crash:** peers report a terminal `failed` status on any non-`collab_done`
  exit; coordinator adds a **boot deadline** + reacts to observed child exit; `spawn()`
  gets an `'error'` handler. → no more 30-min freeze, no coordinator crash.
- **Context:** coordinator distills a `BRIEF.md` (goal + conversation intent) into the
  committed scaffold; `PARENT_TASK` revived as a turn preamble; prompts tell agents to
  read the brief and recall/save memories.
- **Archive:** every run is persisted under `~/.moxxy/collab/runs/<runId>.json`
  (task, brief, roster, per-agent status+summary, board, contracts, merge result,
  timestamps) with artifacts; transient run dirs/worktrees/branches are cleaned up;
  `collab.history` IPC + a desktop history view.
- **Cheap wins:** self-reported `working` status; `peerMaxIterations` plumbed; capped
  `peer_diff`; fail-closed roster approval; duplicate-register guard.
- **Vision seed:** roles are first-class (architect can assemble a real PM/designer/dev/
  QA/writer team; no more force-overwrite).

## 7. Roadmap (deferred — logged to TECH_DEBT)

- **S2 — Dynamic roles, properly:** a role-profile registry `{systemPrompt, tool/skill
  allow-list, deliverable-kind}` (swappable-block pattern), per-role model right-sizing.
- **S3 — Real pipeline:** roster `dependsOn` + topological/staged scheduling
  (design→build→QA), a wired QA/verify gate (`verifyGate`) + reviewer role + an
  iteration/rework loop, a PM/discovery phase with clarifying questions.
- **S4 — Any deliverable:** abstract the workspace/deliverable seam off git+files
  (artifact store + non-git isolation + assemble step) so docs/designs/research and
  non-file roles work.
- **Hardening:** isolate the architect behind the approval gate; bind hub identity to
  the connection; realpath the peer-read guard; stash (not commit) the WIP snapshot;
  curate child env; stream per-peer transcripts into the Collaborate view.
