---
'@moxxy/cli': minor
'@moxxy/plugin-cli': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/plugin-telegram': patch
'@moxxy/sdk': patch
'@moxxy/desktop': minor
'@moxxy/desktop-host': minor
'@moxxy/desktop-ipc-contract': minor
'@moxxy/chat-model': minor
'@moxxy/client-core': minor
'@moxxy/agent-connection-kit': patch
---

Collaborative mode is gone. The desktop no longer has a Collaborate tab, the terminal no longer has `/collab`, and the CLI no longer has the internal `moxxy collab` and `moxxy agent` commands. The `@moxxy/mode-collaborative` and `@moxxy/plugin-collab` packages are no longer bundled and were removed from the repo and from the install catalog. The `collab.*` desktop IPC commands and events and the `CollabRunSummary` type were removed, along with `CollaborationBlock` and its views in `@moxxy/chat-model`. Collaboration events in old saved runs are no longer shown.
