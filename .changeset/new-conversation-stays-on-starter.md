---
'@moxxy/core': patch
'@moxxy/cli': patch
---

A new conversation starts on the light starter model (Haiku 5.5 for Claude) also after `/new` and after a restart. A new session wrote the first model its provider lists (Fable) into its file before any turn ran, and a runner restarted before the first turn took that as the model the conversation last ran on; `/new` in the terminal, a bot chat or an attached desktop kept the old conversation's model. The file now names a model only once a turn ran on it, an empty conversation is not given one on restart, and `/new` forgets the old conversation's model.
