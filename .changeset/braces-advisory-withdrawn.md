---
---

Drop the accepted `braces` advisory (GHSA-vfj7-8cjw-p6xm) from the dependency audit policy: GitHub withdrew it on 2026-10-23, so the audit no longer reports it and failed on the stale entry. SECURITY.md also loses that row and the `sprintf-js` row left behind when its advisory was withdrawn, and a test now fails when the table lists an advisory the policy no longer accepts.
