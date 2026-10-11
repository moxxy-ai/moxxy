---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

An image a tool returned now shows in the conversation: in the desktop as a thumbnail under the tool's line that opens in the image preview, in the terminal as a line naming its kind and size. That covers Moxxy's own screenshot tools and what Claude, Codex and OpenCode look at while they work: a screenshot taken while controlling the computer, an image file read, the file Codex's `view_image` names. Before, the agent connections dropped the image, and the desktop showed the image of a Moxxy tool as base64 text. The SDK exports `toolImageOf` and `imageToolOutput`.
