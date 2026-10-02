---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Five faults the test suite found the first time it ran on Windows: a one-level isolation path rule (`dir/*`) also matched files in subfolders, `Glob` found nothing for a pattern with a folder in it (`src/**/*.ts`), the desktop showed an empty diff for a new file, `moxxy mobile` could neither start nor stop Expo, and a component update failed for anyone with a linked plugin. The whole suite now runs on Windows in CI.
