---
"@moxxy/desktop": patch
---

Keep the desktop chat surface in a loading state while a newly selected session's runner is still starting, and keep retrying model/provider metadata until a cold runner exposes it.
