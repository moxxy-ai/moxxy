---
'@moxxy/cli': patch
'@moxxy/sdk': patch
---

An agent that joins a long conversation, or whose own session is gone, now searches the conversation before it answers about something older. Moxxy hands it the latest turns word for word and one line for each older turn; that record now says it is incomplete and tells the agent to call `recall` before answering and never to say it does not know without searching. Before, Codex answered "I only have a short summary of that turn" and offered to look instead of looking.
