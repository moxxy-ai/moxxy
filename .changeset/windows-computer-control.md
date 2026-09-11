---
'@moxxy/sdk': minor
'@moxxy/cli': minor
'@moxxy/desktop': minor
'@moxxy/plugin-computer-control': minor
---

Add an independent Windows x64 Computer Use helper with explicit window and observation targets, bounded UI Automation, capture metadata, input cancellation and desktop ownership. Preserve existing macOS operations and clean screenshot files after conversion failures.

Preserve unchanged window identities, reject changed control values, explicitly restore minimized windows, support verified background EDIT value changes, and wait locally for focus without replaying interrupted input. Native protocol v2 separates active execution deadlines from human waiting and supports explicit pause/resume. An independent guardian retains the injected-input ledger across worker termination.

Move accessible pause/resume/stop controls into a non-activating native guardian panel. Add an installed-application catalog and explicit reuse/new-instance launching with correlated window results instead of command-text interpolation.
