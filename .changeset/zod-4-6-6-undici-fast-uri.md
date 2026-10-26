---
'@moxxy/sdk': patch
'@moxxy/cli': patch
'@moxxy/plugin-browser': patch
'@moxxy/desktop': patch
---

Move to zod 4.6.6, the fix for GHSA-mrhx-c7xc-m3w5 (a crafted value could make validation use up memory). Moxxy keeps zod 3's API from it: every import is now `zod/v3`, and `z` from `@moxxy/sdk` is zod 3's API as before, so schemas, validation and the tool schemas models see are unchanged. The SDK's `zod` peer range is now `^4.6.6`. A plugin should build its tool schemas with `z` from `@moxxy/sdk` or `zod/v3`: one built with zod 4's API reaches the model with no fields. Also pick up undici 8.12.3, 7.30.1 and 6.29.1 (GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472) and fast-uri 3.1.9 (GHSA-w74x-v6f9-j3xg and three more).
