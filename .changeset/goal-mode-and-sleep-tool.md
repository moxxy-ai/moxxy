---
"@moxxy/cli": minor
---

Add a `Sleep` built-in tool and a new `goal` mode (`/goal <objective>`).

- **`Sleep` tool** — lets the agent pause for a set duration (`seconds` and/or `ms`, capped at
  5 minutes, abort-aware) to wait on an external/async process before re-checking, instead of
  busy-looping.
- **`goal` mode + `/goal`** — `/goal <objective>` switches into the new `goal` mode,
  auto-approves tool calls (yolo), and starts working immediately. The mode runs the normal
  tool-use loop, then re-checks after each round (running the project's build/tests for code
  objectives) and keeps going until the objective is verifiably delivered — stopping on a
  verified completion, when it's blocked awaiting the user, on a safety-cap, or when the user
  interrupts (Esc/Ctrl-C). Available in every channel via `/mode goal`.
