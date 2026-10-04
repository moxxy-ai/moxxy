---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A runner socket path too long for the system to bind — a deep `MOXXY_HOME`, a long user name, a long `MOXXY_RUNNER_SOCKET` — no longer gets cut short silently, which made every desktop session after the first fail with "moxxy serve exited before binding" and could connect one session to another's runner: it moves to a short name in the user's private runtime or temp folder, or the runner refuses with the reason. On a fresh home, "New session" in the Moxxy workspace works instead of failing with "unknown desk: moxxy", as do renaming it, bringing it to front and moving a session into it.
