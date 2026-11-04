---
'@moxxy/desktop': patch
---

A link to a file on Windows written as `/D:/folder/file` opens instead of saying "This file is not there". Agents often write Windows links this way, and the earlier fix only covered `D:\…`, `D:/…` and `file:///D:/…`.
