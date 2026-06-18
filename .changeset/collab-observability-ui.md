---
"@moxxy/chat-model": minor
"@moxxy/desktop": minor
---

feat(desktop): redesign the Collaborate feed + task details, deliverables, message cards

The Collaborate tab showed the team's messages as flat monospace rows
(`agent → all · subject: body`) and gave no way to inspect a task or see what
the run produced. Redesigned for observability:

- **Message cards.** Each message is now a card with a coloured author chip
  (human vs agent), a kind chip derived from the subject (kickoff / progress /
  done / blocked / directive), a broadcast-vs-DM tag (`📣 all` vs `→ agent`), a
  timestamp, and the body — so a long run reads like a team channel, and direct
  messages are visually distinct from broadcasts.
- **Tasks → modal.** Task-board rows are clickable and open a modal with status,
  owner, detail, and the files the item covers.
- **Deliverables.** A new rail section lists the distinct files the team
  claimed/produced; the task view (`CollabTaskView`) now folds `paths` + `detail`
  from the board stream.

Adds folding-test coverage for the new task fields.
