---
'@moxxy/desktop': patch
'fixture-recorder': patch
'@moxxy/anonymizer': patch
'@moxxy/chat-model': patch
'@moxxy/desktop-host': patch
'@moxxy/desktop-ipc-contract': patch
---

Replace non-null assertions (`x!`) and deep optional chains (`a?.b?.c`) with
guard clauses across the desktop-group packages, per the "Guard, don't chain"
rule. Behaviour is preserved: silent-absence paths keep their early return /
single-level `?.` / fallback, while accesses that are impossible-by-construction
(in-bounds loop indices, mandatory regex capture groups, class invariants,
checked preconditions) now fail loudly at the assumption site via
`assertDefined`/`invariant` instead of a cryptic downstream `undefined`.

Browser-bundled code (`@moxxy/chat-model` and the desktop renderer) uses a small
dependency-free local guard helper rather than importing the helpers from the
`@moxxy/sdk` root barrel, which transitively pulls Node-only modules (`node:fs`)
and cannot be bundled for the browser.
