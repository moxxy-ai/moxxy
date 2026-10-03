---
'@moxxy/sdk': minor
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Fast mode: `context.fast` (and the desktop's model panel) asks OpenAI for its priority tier on models that offer it (`supportsFast`). The conversation's reasoning effort and fast mode live in the session, reported in `SessionInfo` and switched with `session.setFast` (runner protocol v24), so every client shows the same values; reasoning that is on without a set effort shows as **Default**, not Off. Effort and fast switches made in quick succession reach the runner in order, the last one winning. The desktop sets both under the model list in **Model & usage** instead of in Settings → Providers.
