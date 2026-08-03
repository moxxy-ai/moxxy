---
'@moxxy/cli': minor
'@moxxy/sdk': minor
'@moxxy/desktop': minor
---

Bound a session's context by policy instead of by how long it has been running, and give the desktop a real keymap.

A new default compactor (`segments`) records every finished turn as one dense sub-session record (Asked / Did / Outcome / Facts / Open) that replaces the turn's raw events in context. Once the index of records passes its cap the oldest fold into a chapter, so the index is bounded too. Nothing is lost: the event log keeps every original event, the new `session_recall` tool searches the records, and `recall({ turnId })` restores one sub-session verbatim. `summarize-old-turns` stays registered as the protected floor and is selectable via `plugins.compactor.default`.

SDK: compaction ranges now supersede any earlier range they fully contain (`activeCompactionRanges`), which is what lets a compactor re-compact its own summaries; projection and the token estimate share that one decision. `summarizeWithProvider` is extracted so compactors don't each re-implement the summarize-or-degrade-but-never-on-abort contract.

Desktop: one registry-backed keymap with a single window dispatcher: ⌘K palette, ⌘L composer, ⌘F search, ⌘. interrupt, ⌘N session, ⌘⌥↑/↓ session switching, ⌘B sidebar, ⌘J workbench, ⌘1-5 destinations, ⌘, settings, ⌘/ for the shortcut sheet, which renders from the live registry so it cannot drift from what is bound.

Also fixes a pre-existing name drift: the CLI's compactor floor and built-in default referred to `summarize`, but the def is named `summarize-old-turns`, so neither ever matched.
