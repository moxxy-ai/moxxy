---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Security + correctness audit of the newly-merged features (collab / anonymizer / mini-apps)

Applied the quality sweep to the features that landed during it. Real bugs fixed,
each with a regression test:

- **mode-collaborative (security, high):** path-traversal / arbitrary-file-read in
  the peer-read confinement — a `startsWith(dir)` prefix check let a peer agent
  read sibling-dir files outside its worktree. Replaced with segment-aware
  containment (`resolve`+`relative`). Also fixed abort-listener leaks in the poll
  loops.
- **plugin-collab (security/correctness):** `boardRelease`/`boardClaim` by public
  id skipped the owner check (lock-stealing + ownership-hijack across peers), and
  a crashed agent's file locks were never freed (deadlock). Ownership now enforced
  on the id path; crashed/killed agents release their claims.
- **anonymizer (security/perf):** NER span aggregation mislocated short entities
  (a **PII-leak** — redacted the wrong region, left real PII), the worker leaked
  in-flight promises on teardown/error, and overlap resolution was O(n²). Fixed.
- **app installer (security):** the asset download had no source allow-list (SSRF)
  and no size cap (disk-fill DoS); both added. The `moxxy-app://` protocol handler
  was audited and confirmed escape-proof.
- mini-apps framework + collaborate UI: worker-leak fix, IPC boundary Zod test
  coverage, and extracted/tested pure render helpers.
