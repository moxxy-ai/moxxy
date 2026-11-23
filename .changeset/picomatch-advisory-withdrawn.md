---
---

The dependency audit no longer accepts GHSA-fc5q-39xc-vjpf: GitHub withdrew the picomatch advisory on 2026-11-18, so `pnpm audit` stops reporting it and the stale acceptance was failing CI. `SECURITY.md` lists no open advisory now.
