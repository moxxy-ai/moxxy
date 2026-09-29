---
'@moxxy/cli': patch
---

Bump @napi-rs/keyring to 2.1.0. Vault keys already stored in the OS keychain stay readable; keychain errors now surface instead of reading as empty, and the vault still falls back to the on-disk key.
