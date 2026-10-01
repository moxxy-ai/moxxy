---
'@moxxy/cli': patch
---

Computer Use fixes found by running real tasks through Moxxy on macOS. A tool call is no longer rejected when the model fills the fields it does not use with `0`, an empty string or `null` (for example `x: 0, y: 0` next to an `element_index`). An app with no open window now takes key presses, so a shortcut such as Command-N can open one. A running app that the system shows under a translated name is found by the name of its bundle too.
