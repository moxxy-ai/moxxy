---
'@moxxy/tools-builtin': patch
'@moxxy/cli': patch
---

Dead-code cleanup: remove the deprecated `resolveSafe` alias from tools-builtin (no callers remained — use `resolvePath`), and retire/re-point stale TECH_DEBT entries (the CDP screencast sidecar handlers were already deleted in #212; the piped-shell fallback and terminal-sizing constraint notes now point at `packages/plugin-terminal` / `TerminalPane.tsx` where that code actually lives).
