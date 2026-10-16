---
'@moxxy/cli': patch
'@moxxy/sdk': patch
---

Reading an agent CLI's version and trimming the project folder of a diff path take time linear in the text, instead of quadratic on a long run of digits or separators. Collaborative-mode tests on real git get a longer timeout on Windows.
