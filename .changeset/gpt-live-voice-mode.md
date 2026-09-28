---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Desktop Voice Mode can now talk through GPT-Live over the existing ChatGPT login (Settings → Preferences → Voice). GPT-Live holds the conversation itself with the chat as context; when the user explicitly asks for a task, the user's own transcribed words run as an ordinary agent turn and GPT-Live reads back that turn's real result. Conversation it answers itself is recorded into the chat through the new runner method `session.recordExchange` (runner protocol v16).
