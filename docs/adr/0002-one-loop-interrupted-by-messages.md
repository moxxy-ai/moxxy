---
status: accepted
---

# One agent loop, interrupted by messages

A person must be able to talk to an agent while it works and get an answer in
seconds, without the work being cancelled. We keep a single loop per
conversation: a message from a person interrupts the agent's thinking and
waiting, never an action that is already running, and the agent resumes from
where it stopped. We did not add a second, always-free agent that talks while a
worker works.

## Considered Options

- **A talker beside a worker.** One model answers the person while another does
  the work. Rejected: two contexts drift apart, the talker reports on work it
  cannot see, and every surface would need both.
- **Queue messages until the turn ends.** This is what moxxy did. Rejected: a
  person waits minutes to say "stop" or "change the colour".
- **Interrupt anything, including a running action.** Rejected: a command or a
  publish stopped halfway leaves the world in a state nobody chose.

## Consequences

- A long single action still delays the reply, so the agent runs long commands
  as background jobs and waits on them interruptibly.
- A reply the model was writing when the message arrived is discarded and paid
  for.
- Automatic events (schedules, webhooks, finished jobs) are read before the
  next model call but do not hold actions; only a person's message does.
