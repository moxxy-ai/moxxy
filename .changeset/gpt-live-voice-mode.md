---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Desktop Voice Mode can now talk through GPT-Live over the existing ChatGPT login (Settings → Preferences → Voice). GPT-Live holds the conversation itself with the chat as context; when the user explicitly asks for a task, the user's own transcribed words run as an ordinary agent turn and GPT-Live reads back that turn's real result. Conversation it answers itself is recorded into the chat through the new runner method `session.recordExchange` (runner protocol v16). While a task runs, GPT-Live hears the agent's progress and answers status questions itself; the agent works on one task at a time, so a task asked for by voice while it is busy is not started (voice never feeds the chat queue). Nothing is sent to GPT-Live while it is speaking, so its answers are no longer cut off mid-sentence. Voice conversation spoken while the agent works is appended to the chat after that turn ends, so it never enters the running task's context.
