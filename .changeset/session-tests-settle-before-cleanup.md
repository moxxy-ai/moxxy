---
---

The session persistence tests wait for their writes to finish before removing their folders, so a write that lands late no longer fails the cleanup on Windows.
