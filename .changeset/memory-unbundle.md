---
'@moxxy/plugin-memory': minor
'@moxxy/core': patch
'@moxxy/cli': minor
'@moxxy/plugin-plugins-admin': patch
'@moxxy/desktop': patch
---

The slim wave's last unbundle: `@moxxy/plugin-memory` moves out of the CLI
binary as ONE merged plugin (long-term store + memory tools + the tfidf
embedder + memory_consolidate and its nudge hooks — the two-plugins-in-one-
package blocker is gone). The store's embedder now resolves lazily from the
new core-published `embedders` service instead of a bootstrap closure.
Installs on demand / rides the desktop seed; without it, `moxxy doctor`
reports a warn ("memory plugin not installed") instead of failing and
recall degrades exactly as before. The `@moxxy/memory-consolidate` ledger
key is gone (clean-slate) — enable/disable the one package instead.
