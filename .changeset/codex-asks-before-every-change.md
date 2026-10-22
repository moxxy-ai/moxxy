---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

With auto-approve off, Codex asks before it changes anything again. Moxxy ran it with approval policy `on-request` and a read-only sandbox, which left asking to the model; at the low effort Moxxy gives an agent by default it mostly tried the write, was blocked and replied that it could only read. Codex now runs with `untrusted`, so Codex itself holds every command but a known-safe read, and every edit, until the person answers. Its sandbox is the workspace rather than read-only, as a model told it may only read at times declined a change before Codex could ask. A Codex that no longer takes `untrusted` falls back to `on-request` with a read-only sandbox. `pnpm test:agents:live` checks that Claude and Codex ask before a change when auto-approve is off.
