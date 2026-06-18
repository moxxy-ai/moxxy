---
"@moxxy/desktop": minor
---

feat(desktop): eagerly migrate every NDJSON-only chat into the runner log (complete the consolidation)

Completes the dual-history consolidation: at startup the desktop now eagerly
migrates EVERY chat whose history still lives only in the NDJSON mirror into the
runner's authoritative log (`migrateAllChatsToSessions`), not just the ones the
user happens to open. After this the runner is the single source of truth for ALL
chats.

- Fire-and-forget at `registerIpcHandlers` startup; idempotent + best-effort +
  non-destructive (skips chats the runner already owns, leaves the NDJSON files
  intact, one unreadable chat never aborts the rest). The runner pool still seeds
  on open as the per-chat guarantee.

The NDJSON store is now fully frozen — not written (for v10 runners) and no longer
the source of truth — but its files + read-fallback code are retained as a safety
net. Physically deleting them is deliberately left as a later cleanup gated on a
packaged-desktop live-verify (it is destructive and touches self-update-sensitive
paths).
