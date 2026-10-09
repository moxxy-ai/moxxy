---
'@moxxy/cli': patch
---

A run of browser steps can now set a box, a switch or a toggle to a state: `check` to have it on, `uncheck` to have it off. The step reads the element first, does nothing when it is already that way, and otherwise clicks once and reads that it changed. Before, the agent clicked a box that was already ticked, expecting it to stay on, and switched it off.
