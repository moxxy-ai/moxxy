---
'@moxxy/runner': minor
'@moxxy/plugin-workflows': minor
'@moxxy/sdk': minor
'@moxxy/cli': minor
'@moxxy/desktop': minor
'@moxxy/desktop-ipc-contract': minor
'@moxxy/desktop-host': patch
'@moxxy/plugin-channel-mobile': patch
'@moxxy/client-core': minor
---

feat(workflows): human-in-the-loop awaitInput — resume RPC + operator reply UI (un-gate)

A workflow step can set `awaitInput: true` to pause and ask the operator a
question, then continue with their reply. #146 gated this at validate/save time
because the resume path hadn't shipped. The resume path now ships, so the gate
is removed.

- **Un-gate:** `awaitInput: true` is accepted again on **prompt/skill steps**
  (rejected on tool/workflow/logic/loop steps and on a loop body); `draft.ts`
  teaches the mid-run pause flow again with a worked example.
- **Resume RPC (additive, protocol v5):** new `RunnerMethod.WorkflowResume`
  (`workflow.resume`) — server handler → `session.workflows.resume(runId, reply)`;
  `WorkflowsView.resume` (SDK) + CLI impl over the existing `resumeWorkflowRun`;
  `RemoteSession` client method gated on server protocol `>= 5` with the actionable
  "update the CLI" error (mirrors the v4 builder gate). `MIN_COMPATIBLE` stays at 1.
- **Desktop / mobile / TUI:** `workflows.resume` added to the desktop IPC contract
  (+ host handler), the MobileSessionHost bridge, and `REMOTE_ALLOWED_COMMANDS`
  (RESPOND-only — answering a question the workflow asked, like `ask.respond`).
  Operator reply UI: desktop paused-workflow card (new client-core
  `usePausedWorkflows` hook) and TUI inline reply in the `/workflows` panel.
- **Correctness:** the `workflow_paused` event now carries the workflow name +
  step label + question; vars set before a pause survive the checkpoint round-trip;
  `runNow` keeps treating a `paused` result as non-terminal (and the resume side
  delivers the now-completed run to the inbox); the stale-checkpoint sweeper +
  `clearRetainedChildren()`-on-shutdown are kept.
