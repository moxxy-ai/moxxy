---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Update hono to 4.13.13 and follow-redirects to 1.16.1, which fix newly published advisories (a middleware bypass in hono's static serving, and credential headers kept across redirects in follow-redirects).
