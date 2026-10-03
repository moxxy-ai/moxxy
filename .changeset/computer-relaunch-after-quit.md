---
'@moxxy/cli': patch
---

Computer Use starts an app again when it is asked for right after the app quit. macOS keeps listing a quit app for a moment, longer on a busy Mac; the macOS helper took that entry for the running app and answered "has no open window" instead of launching it. A listed app whose process is gone no longer counts as running, and the helper starts a new instance in its place. The flaky durable workflow-approval test now waits for the request files instead of a fixed pause.
