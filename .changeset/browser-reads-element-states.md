---
'@moxxy/cli': patch
---

Moxxy Browser now reads whether a box is ticked, a toggle pressed, an item selected, a section open or closed, and a control disabled, and shows it on the element's row (`[checked]`, `[disabled]`, …) and to Jev. Before, a ticked box read exactly like an unticked one: the agent clicked a box that was already on and turned it off, or ticked a box, was told nothing had changed, and clicked it again.
