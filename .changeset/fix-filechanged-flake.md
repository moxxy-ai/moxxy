---
'@moxxy/cli': patch
---

Fix the workflows `fileChanged`-across-two-runners test, which was still failing after being declared fixed.

The earlier attempt treated it as a timing budget and raised the timeout. It is not a timing problem: `fs.watch(dir, { recursive: true })` is FSEvents on macOS and is not delivering yet when the call returns, so the single write issued right after boot fell into that gap and was dropped outright. No amount of waiting rescues a dropped event, which is why the bigger budget changed nothing.

The test now writes in a bounded retry loop and stops at the first observed run. Retrying cannot weaken the at-most-once assertion it exists for, because duplicates collapse twice over: the 600ms debounce coalesces events per watch key, and the `wf-file:` fire lock (3s TTL) coalesces fires per key across both runners.

No production code changed.
