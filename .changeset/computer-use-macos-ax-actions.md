---
'@moxxy/cli': patch
---

Computer Use (macOS helper): act on an element by its index from the last app state. A plain click presses the element through accessibility (AXPress, or AXShowMenu for a right click), set_value writes text or a number into an editable element, and perform_secondary_action runs only an action the element itself lists. The agent cursor glides to the element, frames it, marks the press and reports moving, executing and delivered or failed. An index the helper never handed out is refused as stale, an action before any observation asks for one, an unknown accessibility error blocks the action instead of retrying it, and every answer carries the app's fresh state. Apps installed outside the standard folders now resolve by bundle identifier.
