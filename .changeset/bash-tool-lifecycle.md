---
'@moxxy/tools-builtin': patch
---

Bash tool hardening: timeout/abort now kill the child's whole process group (detached spawn + negative-pid signal) with SIGTERM → 2s → SIGKILL escalation, so forked children no longer survive as orphans or hang the tool by holding stdio pipes; and child output is bounded during streaming (drain-and-count past the 200k clamp) so runaway commands can't grow the heap unboundedly while keeping the existing truncation marker accurate.
