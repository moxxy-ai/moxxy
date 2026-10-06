---
'@moxxy/sdk': minor
'@moxxy/cli': patch
---

A tool can be marked `alwaysLoaded` to stay in the request when the tool list is loaded lazily. Computer Use marks `computer_request_access` and `computer_run`, so a task no longer spends a model round on `load_tool`.
