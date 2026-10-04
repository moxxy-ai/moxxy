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

## Stage 7 — the whole update, with Jev off and on

Every stage done (reliable actions, per-site consent, the agent's pointer and
taking over, picture mode and uploads, `browser_run` through Jev, the skill).
Each task run twice from the same start: once with no TypeSafe key (the single
browser tools only) and once with the key and Jev on (`browser_run` offered).
The run memory of `browser_run` was empty at the start of the round, so Jev
had learned nothing about these sites beforehand.

| Task | Baseline | Jev off | Jev on |
|---|---|---|---|
| wiki | failed · 19 s · 4 tools · 1 ask | **done** (3343 m) · 28 s · 10 model calls · 9 tools | **done** (3343 m) · **18 s** · 6 model calls · 5 tools |
| books | wrong answer · 21 s · 5 tools · 2 asks | **done** (£23.21) · 23 s · 8 calls · 7 tools | **done** (£23.21) · **18 s** · 6 calls · 5 tools |
| form | partial · 26 s · 7 tools · 2 asks | **done** ("Form submitted") · 24 s · 9 calls · 8 tools | **done** ("Form submitted") · 24 s · 6 calls · 5 tools |
| edge | failed, 3 of 7 · 183 s · 42 tools · 26 asks | **done, 7 of 7** · 39 s · 12 calls · 14 tools | **done, 7 of 7** · 39 s · 11 calls · 10 tools |
| canvas | failed · 70 s · 18 tools · 14 asks | **done** (rectangle labelled "Moxxy") · 39 s · 13 calls · 12 tools | **done** (rectangle labelled "Moxxy") · 40 s · 13 calls · 12 tools |

"Asks" fell to one per task (two where the agent also used `browser_session`
or `browser_dialog`): `browser_allow_site` once for the site, then no prompt
per action. The answers were checked, not taken on trust: the height, the
price, the form's result page and the edge task's result line are the right
values, and both canvas runs' final pictures show the labelled rectangle.

**Against the baseline:** five of five tasks done in both modes, against none
of five; the edge task is about 4.7 times faster, with a third of the tools
(a quarter with Jev on).

**Jev on against Jev off:** the same five of five, with a quarter fewer tool
calls (37 against 50 over the round), a fifth fewer model calls (42 against
52), and the wiki and books tasks 5–10 s faster. Where the work is a picture
(canvas), Jev adds nothing — that work goes through `browser_point` either way.

### What the earlier rounds of stage 7 found

Two rounds before this one changed the code:

- **`browser_run` was never used** while it was described as one tool among
  many. It is now the default way to act whenever it is offered.
- **Actions that worked were reported as failed** — an alert that opened, a
  banner that went away, a link that opened a tab — because Jev was asked about
  the page after the step, which does not show any of those. Jev now also sees
  what the action reported and what appeared and went away, asked as two
  separate questions; a step delivered but not confirmed is "unverified", not
  failed.
- **Without Jev, the model gave up** on a search that landed on a
  disambiguation page and asked the user to click; on a list it answered from
  the first item. The skill now says to finish the task and to compare every
  item.
- **A take-over in the middle of a run** stopped one Jev-on edge run. It did
  not come back in a probe that repeated the same steps, and every press the
  agent made in that probe was its own. The trial window now logs every press
  and key the pages get, so another one can be traced to its cause. None
  happened in this round.
- Runs where the model looped on `collab_inbox` (twice, unrelated to the
  browser) were discarded.
