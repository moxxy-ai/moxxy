---
'@moxxy/cli': patch
---

Research mode plans for the newest question, with up to five earlier questions only as context, so it no longer searches again for topics the conversation already covered. On the Claude Agent, one-off requests (summaries, skill drafts, memory, the research plan) load none of the person's MCP servers or claude.ai connectors, so research on Claude no longer ends on "Reached maximum number of turns (1)" when Claude reached for one of them.
