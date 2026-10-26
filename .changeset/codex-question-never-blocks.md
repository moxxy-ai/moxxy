---
'@moxxy/sdk': minor
'@moxxy/core': patch
'@moxxy/client-core': patch
'@moxxy/channel-kit': patch
'@moxxy/plugin-provider-codex-agent': patch
---

A question the agent asks can no longer leave the conversation stuck.

- A question Codex asks while it works is shown at once instead of when its turn ends. An answer given while Codex works goes into its running turn. When Codex finishes without the answer, the question closes with the note that Codex went on. When Codex ends its turn on the question (plan mode), it still waits for the answer as before.
- A new message from the person closes any question an earlier turn still waits on, so that turn ends and the new message runs. A message an agent or a trigger started does not.
- An open question stays on screen while any turn runs, not only while the turn that asked it runs.
- The question card on Telegram and Discord says why a question closed: the agent went on, or a new message was sent.
- Desktop and terminal history keep the reason a question closed without an answer. A new message interrupts a Codex turn blocked on native user input before that turn can keep waiting on an empty answer.
- `@moxxy/sdk`: `QuestionAsker` callers can pass `{ signal }` to `ModeContext.ask` and `AgentStepHost.ask`; aborting it with `QUESTION_CLOSED_AGENT_WENT_ON` closes the question with that note. A dismissed `QuestionOutcome` and the `question_resolved` record carry an optional `note`. New exports: `QUESTION_CLOSED_AGENT_WENT_ON`, `QUESTION_CLOSED_NEW_MESSAGE`, `questionCloseNote`, `QuestionCloseNote`, `QuestionAskOptions`.
