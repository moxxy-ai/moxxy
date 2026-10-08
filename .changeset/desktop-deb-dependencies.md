---
'@moxxy/desktop': patch
---

The Linux `.deb` installs on a minimal system: it now brings the sound library the app needs to start and `xz`, which unpacks the bundled Node. Both were assumed to be there, which holds on a desktop Ubuntu and not on a minimal install.
