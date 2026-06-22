---
'@moxxy/plugin-channel-mobile': patch
---

Move the bundled Expo app from `apps/mobile-plugin/mobile` to `apps/mobile` and
point the `moxxy mobile` Expo launcher at the new location. Without this the
launcher's directory resolver still walked to `apps/mobile-plugin/mobile`, so the
full app could not be found after the rename. Workspace glob, EAS build workflow,
docs, and tests were updated to match.
