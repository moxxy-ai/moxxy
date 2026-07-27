---
'@moxxy/cli': patch
---

TUI polish: stop leaking bearer tokens into scrollback, drop the banner from piped output, degrade the status line on narrow terminals.

The permission dialog redacted by field NAME only, so a Bash call's `command` printed `curl -H "Authorization: Bearer sk-ant-…"` verbatim. That is the exact string the dialog exists to show a human, on a terminal that may be recorded or screen-shared. It now uses the SDK redactor, which also masks secret-shaped values inside ordinary fields, so the TUI and the audit trail mask the same things.

`--help` and `--version` no longer print the 31-row mascot when stdout is not a TTY, or when `NO_COLOR` is set. It stays on an interactive terminal, where it is the product's face rather than noise ahead of the answer.

The status line now drops segments by terminal width instead of wrapping, which in an Ink flex row reads as broken rather than degraded. Order of loss is version chip, MCP count, model id, context meter, keeping what changes most often. Width is tracked live, so a resize re-tiers instead of freezing the layout at mount.

The enterprise profile now pins the mobile channel to loopback. It binds `0.0.0.0` by default so a physical phone works out of the box, which on a corporate laptop puts a token-gated listener on the office network.
