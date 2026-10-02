---
'@moxxy/sdk': patch
'@moxxy/cli': patch
---

On Windows a settings change — such as turning a provider off — is no longer lost when another process happens to be reading the same file at that moment. The atomic file writer now waits briefly for the reader instead of failing.
