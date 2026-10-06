---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A page that is still loading is no longer read as work in progress. Chromium marks the whole document busy until it loads, and some pages never finish (n8n's sign-in page), so the agent was told to wait on the page itself and went on working instead of reporting.
