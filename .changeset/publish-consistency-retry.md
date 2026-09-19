---
'@moxxy/cli': patch
---

Wait out npm's read-after-write lag in the post-publish consistency check, so a healthy release stops reporting itself as broken and no longer needs a manual second run.
