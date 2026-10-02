---
'@moxxy/cli': minor
'@moxxy/sdk': minor
---

A session with more than 200 tools now sends the model only the core tools and an index of the rest, without being asked to (`context.lazyTools` unset; `true` and `false` still force it either way). With several MCP servers connected, every request used to carry all tool schemas (513 tools and 410 KB in the measured setup), which cost 7–9 s per request. Tools that share a name prefix are listed as one family and loaded with one call: `load_tool({ name: "computer_*" })`.

SDK: `ToolDef.liveState` marks a tool that looks at state outside the session (a screen, an app). Its repeated calls count toward the stuck-loop guard only when they come back to back. New exports: `shouldGateTools`, `matchLoadableTools`, `LAZY_TOOLS_AUTO_THRESHOLD`.
