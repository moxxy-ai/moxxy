---
'@moxxy/cli': patch
---

The picture Codex views is read with its 8 MB cap held while reading, so a file that grows after its size was checked (or one with no real size, like a device) is no longer read whole. The research planner's header check runs in linear time on a line full of Markdown marks.
