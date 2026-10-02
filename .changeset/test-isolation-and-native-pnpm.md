---
'@moxxy/cli': patch
---

Tests no longer reach the developer's real `~/.moxxy` or OS keychain: the shared test setup points the home directory at a throwaway one on every platform (Windows resolves it from `USERPROFILE`, which the tests never moved), and `MOXXY_NO_KEYCHAIN=1` keeps the vault off the keychain. Desktop resource preparation now also runs under a native `pnpm.exe`.
