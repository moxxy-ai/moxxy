---
"@moxxy/plugin-collab": patch
"@moxxy/mode-collaborative": patch
"@moxxy/cli": patch
---

fix(collaborative): stop the 30-minute hang, the spawn crash, and worktree leaks

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
