---
'@moxxy/cli': patch
---

Skills that plugins ship are loaded. A plugin's `package.json#moxxy.plugin.skills` folder (or its `skillsDir`) was declared but never read, so Computer Use's `computer-control` skill (with its per-app notes), the OAuth skills and `dispatch-agents` never reached the agent, the chat's @ menu or an @ mention. They now load at startup between the builtin skills and the user's own, and `reload_skills` keeps them.
