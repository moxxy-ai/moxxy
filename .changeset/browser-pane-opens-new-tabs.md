---
'@moxxy/desktop': patch
---

A link or button that opens a new tab now opens one in the desktop's browser. The pane's views never actually allowed pages to open windows — the attribute was dropped on the way to the page — so Electron refused every new tab before the app could turn it into one: in Canva, choosing a design to create left you where you were instead of opening the editor beside it.
