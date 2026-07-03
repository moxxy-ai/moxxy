---
'@moxxy/core': patch
'@moxxy/plugin-usage-stats': patch
'@moxxy/cli': patch
'@moxxy/plugin-cli': patch
---

Aggregate skill usage into `~/.moxxy/skills/.meta/usage.json` and surface it.

A new best-effort store in `@moxxy/core` (`skill-usage.ts`) records per-skill-name
`invocations` counts plus first-`createdAt` / latest-`lastInvokedAt` timestamps.
`@moxxy/plugin-usage-stats` folds this run's `skill_invoked` / `skill_created`
events past the same resume/`/new` seq boundary it already uses for token usage
and merges the delta on shutdown (token behavior unchanged). `moxxy skills list`
gains a dim `used` column and the `/skills` TUI panel shows a right-aligned `×N`
badge.

Known limitation: `skill_invoked` is only emitted by the `load_skill` tool today
(reason `load_skill_tool`), so counts reflect explicit `load_skill` calls only.
When trigger-match / classifier emission lands later, the same file simply starts
counting more — no format change.
