---
"@moxxy/cli": patch
---

`MOXXY_HOME` now also moves the permission rules (`permissions.json`), user skills and their audit log, workflows, the memory check in `moxxy doctor`, `moxxy plugins new`, self-update transactions and the policy-bundle cache. They used to stay in `~/.moxxy` even when `MOXXY_HOME` pointed elsewhere. Without `MOXXY_HOME` nothing changes. If you set `MOXXY_HOME` and kept these files in `~/.moxxy`, move them to the `MOXXY_HOME` folder.
