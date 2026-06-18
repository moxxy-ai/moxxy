---
"@moxxy/mode-collaborative": minor
"@moxxy/chat-model": patch
"@moxxy/desktop-ipc-contract": minor
"@moxxy/desktop-host": minor
"@moxxy/desktop": minor
"@moxxy/plugin-cli": minor
---

feat(collaborative): launch collaborations from the Collaborate tab; one at a time

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
