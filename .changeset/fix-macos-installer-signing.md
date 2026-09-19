---
'@moxxy/desktop': patch
---

Fix macOS installer code signing. electron-builder 26.15.3 passed the `.p12` password to `security set-key-partition-list`, which expects the temporary keychain's own password, so signing failed with "The user name or passphrase you entered is not correct" no matter how the certificate secrets were configured. Pin the electron-builder toolchain to 26.16.1, where that is fixed.
