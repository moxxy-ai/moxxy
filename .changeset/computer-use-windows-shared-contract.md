---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Computer Use on Windows x64 now uses the same tools as macOS. The earlier Windows-only tools (`computer_observe`, `computer_windows`, `computer_open`, `computer_action`, …) are removed: the model asks for access to an app with `computer_request_access`, reads it with `computer_get_app_state` (elements with an index plus a picture of the window) and acts by index or by a point of that picture. The Windows helper speaks protocol 5, shows the agent's own cursor over the target window, puts the user's pointer back after a click, hides apps that were not granted in full-screen pictures, and feeds the live picture-in-picture view in the desktop chat. An installed Computer Use extension from an earlier version is offered an update at startup of the Windows desktop app.
