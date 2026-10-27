---
'@moxxy/plugin-provider-claude-code': patch
---

A sentence Claude writes before a tool call no longer marks the end of its turn. Claude Code sends each part of a reply on its own, so the sentence arrived apart from its call and was recorded as Claude's last word; coming back to a chat while Claude still worked then showed it as idle, and a message sent then ran beside the running turn instead of waiting for it. The sentence is now marked by what follows it: a call, the stop reason of the reply, or the end of the turn.
