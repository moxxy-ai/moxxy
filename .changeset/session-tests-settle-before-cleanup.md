---
---

Tests remove what they made with `removeDir` / `removeDirSync` from `@moxxy/vitest-preset/fs`, which wait out the moment Windows refuses to remove a path still in use, and lint rejects a bare recursive `rm` in tests. The session persistence tests wait for their writes, and the subprocess abort test no longer runs its lingering child in the folder it removes. Releases nothing.
