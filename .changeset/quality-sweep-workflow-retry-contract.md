---
"@moxxy/cli": patch
---

Quality sweep — workflow retry contract + DAG concurrency claim (plugin-workflows)

- **`onError: 'retry'` is now behaviorally distinct (u117-3):** the DAG executor
  gates retries on the three-valued `onError` contract — `'retry'` runs
  `1 + retries` attempts, while `'fail'` and `'continue'` run **exactly one**
  attempt regardless of `retries`. Previously retries fired whenever
  `retries > 0` independent of `onError`, so `onError: 'fail' + retries: 3`
  silently retried (a latent trap). Schema/draft docs note the gate; new
  regression tests pin the attempt count for each mode.

- **DAG wave-concurrency claim corrected (u117-1):** the executor description and
  scheduler comment now plainly describe the strictly-sequential within-wave
  execution (`concurrency` caps the batch drained per pass, not wall-clock
  latency) instead of implying parallelism is merely "deferred". Concurrent
  execution of even the pure steps cannot preserve the observable contract
  (atomic per-step event pairs in wave order, hard-failure-stops-the-rest-of-the-
  wave error semantics, wave-ordered `vars` merges), so the behavior is left
  sequential by design. No runtime behavior change for this item.
