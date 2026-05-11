---
name: explain-event-log
description: Walk the user through the moxxy event log for the current session.
triggers: ["show event log", "explain events", "what happened"]
allowed-tools: []
---
# Explain the event log

When the user wants to understand what happened in this session:

1. Summarize the most recent turn: which tools ran, which were denied, the final assistant message.
2. Highlight any `error`, `tool_call_denied`, or `compaction` events.
3. If the user asks "why did X happen?", trace the `causationId` chain.

Be terse — one bullet per event class. Don't dump raw JSON.
