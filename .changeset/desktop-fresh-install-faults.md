---
'@moxxy/desktop': patch
---

Three faults a fresh install showed. On Windows the agent's browser tools now drive the app's own Browser pane: the bridge to it listened on a file path, which Windows cannot do, so the tools fell back to Playwright and failed with "Playwright is not installed". On macOS and Linux the Computer Use helper starts again: packing the plugin into the installer dropped its permission to run ("Computer Use helper cannot start"). And the Browser pane now opens for every browser tool, so a tab the agent asks for no longer times out while the pane is closed.
