---
"@moxxy/cli": patch
---

On Windows, forgetting every Moxxy Browser sign-in right after the browser closed no longer fails with "Permission denied": the profile is removed once Chromium lets go of its files.
