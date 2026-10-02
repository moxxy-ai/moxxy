---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Computer Use on macOS now runs on the native helper. The old macOS tools (`computer_type`, `computer_key`, `computer_open`, `computer_clipboard`, `computer_applescript` and the coordinate-only `computer_click` / `computer_screenshot`) are removed; macOS offers the shared tool set instead: `computer_request_access`, `computer_get_app_state`, element and point actions, `computer_batch`, `computer_zoom`, and `computer_status`, which reports missing system permissions and can open the right settings pane. A Mac without a matching helper offers `computer_status` only, with the reason. The model gets short working rules with every request that carries these tools, and notes for an app (browsers, Finder, office suites, video editors, design tools) the first time it looks at that app in a turn. The desktop app ships the universal helper: packaging on macOS builds it, verifies it, and its manifest stays valid after the app is signed.
