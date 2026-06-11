---
"@moxxy/cli": patch
---

Start the full `apps/mobile-plugin/mobile` Expo app automatically when running `moxxy mobile`, wire it to the working WebSocket bridge/client-core flow proven by the PoC, keep Metro on a single React instance, and make Expo SDK 54's Worklets Babel plugin resolvable under pnpm's strict dependency layout.
