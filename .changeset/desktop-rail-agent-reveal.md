---
"@moxxy/desktop": patch
---

feat(desktop): agent showcases its work in the rail + Preferences tab

**Agent opens the sidebar.** When the agent drives the browser (`browser_session`)
or the terminal (`terminal`), the matching Context-rail pane now opens on its own
so the user sees the work as it happens — no need to open the pane manually. It's
renderer-only (it watches the existing `runner.event` stream and reveals the pane),
reveals each pane at most once per session, and never auto-closes — the rail's
close button stays authoritative.

**Preferences tab.** The "Appearance" and "About" settings tabs are folded into a
single **Preferences** tab (theme + version/update + CLI), so there's one place for
"how the app looks and updates".

Also adds the previously-missing regression test for the browser region-capture →
chat-attach flow.
