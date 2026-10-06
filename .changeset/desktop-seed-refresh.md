---
"@moxxy/desktop": patch
---

Installing a new desktop over an earlier one now moves the plugins in `~/.moxxy/plugins` to the versions the installer carries, on its first launch. A package whose content changed is replaced even when its version number did not, and a package the installer adds is copied in. Plugins updated from npm to a newer version, plugins you added yourself, and the connections the installer updates with a backup are kept. The replaced copies are kept in `~/.moxxy/plugins-backup`, latest only.
