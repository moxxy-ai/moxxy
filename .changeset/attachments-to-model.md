---
"@moxxy/sdk": minor
"@moxxy/cli": patch
---

Support sending documents (PDFs, Office/text) to the model. Adds a `document`
`ContentBlock`, a `supportsDocuments` flag on `ModelDescriptor`, and a
`'document'` `UserPromptAttachment` kind; `projectMessages` routes document
attachments to the native block. The Anthropic, OpenAI, and Codex providers
translate documents to their native shapes (Anthropic `document`, OpenAI
`file`, Responses `input_file`), so attached files now reach the model for
analysis instead of being dropped.
