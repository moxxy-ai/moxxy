---
'@moxxy/cli': patch
'@moxxy/sdk': minor
---

A file that Claude, Codex or OpenCode creates or edits now shows in the conversation as a diff, like an edit Moxxy makes itself: the path inside the project, the added and removed lines with their numbers, and a little context. Before, the chat showed only the agent's text, such as "The file has been updated successfully". The SDK exports the diff builders the connections use: `fileDiffFromText`, `fileDiffFromPatch`, `parseUnifiedDiff` and `diffPathIn`.
