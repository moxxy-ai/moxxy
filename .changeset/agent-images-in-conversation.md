---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

The images a tool returned now show in the conversation: in the desktop as thumbnails under the tool's line, every image of the call, each opening in the image preview; in the terminal as a line naming how many came back, their kind and size. An image sent twice shows once. That covers Moxxy's own screenshot tools and what Claude, Codex and OpenCode look at while they work: a screenshot taken while controlling the computer, an image file read, the file Codex's `view_image` names. Before, the agent connections dropped the image, and the desktop showed the image of a Moxxy tool as base64 text. Every image is also handed to the model after a switch to an API connection. The SDK exports `toolImagesOf` and `imageToolOutput`.
