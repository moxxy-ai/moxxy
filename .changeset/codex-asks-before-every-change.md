---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

With auto-approve off, Codex asks before it changes anything again. Moxxy ran it with approval policy `on-request` and a read-only sandbox, which left asking to the model; at the low effort Moxxy gives an agent by default it mostly tried the write, was blocked and replied that it could only read. Codex now runs with `untrusted`, so Codex itself holds every command but a known-safe read until the person answers; a Codex that no longer takes `untrusted` falls back to `on-request`. `pnpm test:agents:live` checks that Claude and Codex ask before a change when auto-approve is off.
