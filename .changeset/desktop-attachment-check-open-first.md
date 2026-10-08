---
'@moxxy/desktop': patch
---

Checking a file staged for a prompt now opens it first and reads its size from the open file, so a file swapped between the check and the read cannot be measured as one file and read as another.
