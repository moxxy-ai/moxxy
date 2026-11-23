---
'@moxxy/agent-connection-kit': patch
'@moxxy/plugin-provider-codex-agent': patch
'@moxxy/plugin-provider-acp': patch
'@moxxy/cli': patch
---

Codex and OpenCode chats no longer hang when the agent's message holds a line separator. JSON allows the characters U+2028 and U+2029 raw inside a string, and Codex sends them that way, for example in a web page title kept in a thread's history. Moxxy read the agent's output with `node:readline`, which also ends a line at those characters, so such a message was cut in two and lost. A resumed thread whose history held one never answered, and the chat showed a turn running with nothing happening. Moxxy now ends a line only at a newline, and reports a line that is not JSON once per connection, by its size only, with `NODE_DEBUG=moxxy`.
