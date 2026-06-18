---
"@moxxy/plugin-collab": minor
"@moxxy/mode-collaborative": minor
"@moxxy/cli": patch
---

feat(collaborative): dynamic, cross-functional roles (not a pool of identical implementers)

The roster could only ever be `architect | implementer`, and `readRoster`
force-overwrote every proposed role to `'implementer'` — so the architect's
team was always a flat pool of clones, the opposite of the "a PM, a designer,
some developers, a QA, a writer" vision.

- `AgentRole` is now open (`'architect'` stays reserved for the coordinator's
  planner; any other label is a free-form team function).
- `readRoster` carries the architect's proposed `role` (sanitised; a proposed
  `'architect'` is coerced to `'implementer'` since that's reserved) instead of
  hardcoding `'implementer'`.
- The architect prompt now tells it to assemble the RIGHT team for the
  deliverable (developer/designer/pm/qa/writer/researcher/editor/…), not to
  default everyone to "implementer". The peer prompt + seeded turn now lead with
  the agent's role so a writer writes, a designer designs, a QA reviews.

Roles flow straight into the existing roster/archive/UI, which already render
`role`. Adds tests that proposed roles are carried and the reserved role coerced.
