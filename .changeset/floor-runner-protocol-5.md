---
"@moxxy/desktop": patch
---

Fix the desktop release build: bump `FLOOR_RUNNER_PROTOCOL` to 5 to match `RUNNER_PROTOCOL_VERSION` (the workflow.resume bump in #151 raised the runner protocol to 5 but left the desktop floor at 4, so the release-time lockstep assertion in `build-app-bundle.mjs` failed and the desktop release was skipped). Adds a unit test asserting `FLOOR_RUNNER_PROTOCOL === RUNNER_PROTOCOL_VERSION` so a forgotten floor bump fails normal CI instead of only the release.
