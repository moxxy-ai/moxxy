---
'@moxxy/desktop': patch
'@moxxy/cli': patch
---

An agent install (Claude Code, Codex, OpenCode) that ends without the program on the computer now says so and offers Try again, instead of quietly showing Install again. A failed install keeps the installer's own message, adds what to check for a few failures Moxxy can tell for certain (no internet, certificate, full disk, permissions), and every install or update keeps its full output in `~/.moxxy/logs/agent-<command>.log`.

On first launch, Start free waits for the bundled tools before installing OpenCode, so one click is enough even while Moxxy is still setting up.
