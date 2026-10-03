# Moxxy Browser — results by stage

The same five tasks as the [baseline](baseline.md), run the same way
(`apps/desktop/scripts/browser-trial/`, `gpt-6-luna`, effort `medium`, fast mode,
throwaway `MOXXY_HOME`) after each stage of the browser-use update.

## Stage 1 — actions that do what they say

| Task | Baseline | After stage 1 |
|---|---|---|
| wiki | failed (false cookie wall) · 19 s · 4 tools · 1 ask | **done** (3343 m) · 25 s · 6 tools · 3 asks |
| books | wrong answer · 21 s · 5 tools · 2 asks | **done** (£23.21) · 38 s · 11 tools · 3 asks ¹ |
| form | partial (select unset) · 26 s · 7 tools · 2 asks | **done** ("Form submitted") · 17 s · 4 tools · 2 asks |
| edge | failed, 3 of 7 · 183 s · 42 tools · 26 asks | **done, 7 of 7** · 37 s · 12 tools · 5 asks |
| canvas | failed · 70 s · 18 tools · 14 asks | failed · 64 s · 16 tools · 10 asks ² |

¹ The first stage-1 run of books never reached the browser: the model looped on
`collab_inbox` and the run was aborted as stuck. The rerun is the one shown.

² Drawing needs a drag at a point on a `<canvas>`, which no tool offers yet; it
is what stage 4 adds. The first stage-1 run also found every Excalidraw tool
reported as covered — a hit test that counted a `pointer-events: none` layer as
the thing hit — which is fixed and covered by a test.

On the edge task the agent no longer falls back to running JavaScript in the
page (`browser_session`: 9 calls in the baseline, 0 now), and the run is five
times faster with a fifth of the approvals.
