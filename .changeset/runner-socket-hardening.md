---
'@moxxy/runner': patch
---

Harden the runner socket: the socket's parent directory is created/tightened to 0700 before listen (closing the chmod-after-listen window where another local user could connect), socket chmod failures are logged loudly instead of swallowed, and turn aborts are ownership-tracked — a cross-client abort is still allowed (shared-session model) but leaves an audit log naming both connection roles, with `MOXXY_RUNNER_STRICT_ABORT=1` opting into denial. On Windows the named pipe keeps the default DACL (Everyone gets read-only, no write); a one-time warning documents that gap.
