---
---

The dependency audit no longer accepts GHSA-g3hv-75wg-m249: GitHub narrowed it to minimatch 7 and later, so the minimatch 3 and 5 that `electron-builder` pins are no longer affected, and the stale acceptance was failing CI. `SECURITY.md` lists no open advisory now.
