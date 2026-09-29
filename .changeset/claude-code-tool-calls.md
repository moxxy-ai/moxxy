---
"@moxxy/cli": patch
"@moxxy/plugin-provider-claude-code": patch
---

claude-code provider: moxxy tools now work in the default text transport. They are described to Claude in the prompt and its call blocks become real tool calls that go through moxxy's permission flow, instead of the model printing a fake tool call as plain text. Internal CLI `tool_use` stop reasons no longer abort the stream.
