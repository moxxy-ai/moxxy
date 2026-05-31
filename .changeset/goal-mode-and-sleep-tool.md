---
"@moxxy/cli": minor
---

Add a `Sleep` built-in tool and a new `goal` mode (`/goal <objective>`).

- **`Sleep` tool** — lets the agent pause for a set duration (`seconds` and/or `ms`, capped at
  5 minutes, abort-aware) to wait on an external/async process before re-checking, instead of
  busy-looping.
- **`goal` mode + `/goal`** — `/goal <objective>` switches into the new `goal` mode,
  auto-approves every tool call (yolo) for the run, and starts working immediately. Unlike
  tool-use, the loop does NOT end when the model stops emitting tools — it keeps re-prompting
  the model to continue until the model explicitly calls the `goal_complete` tool (success,
  with a summary + evidence) or `goal_abandon` (blocked, needs the user). Every run is bounded
  by an iteration cap, a cumulative token budget, a stuck-loop detector, and no-progress
  detection, and stops immediately on user interrupt (Esc/Ctrl-C). Available in every channel
  via `/mode goal`.
