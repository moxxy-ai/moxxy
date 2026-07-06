---
'@moxxy/cli': patch
'@moxxy/config': patch
'@moxxy/plugin-cli': patch
'@moxxy/plugin-commands': patch
'@moxxy/plugin-oauth': patch
'@moxxy/plugin-plugins-admin': patch
'@moxxy/plugin-provider-admin': patch
'@moxxy/plugin-self-update': patch
'@moxxy/plugin-vault': patch
---

Replace non-null assertions (`x!`) and deep optional chains (`a?.b?.c`) across
the CLI package group with guard clauses. Impossible-by-construction reads now
fail loudly via `assertDefined`/`invariant` with a stated reason; genuinely
optional reads keep their silent path (single-level `?.` / early return /
default). No behavior change on any reachable path.
