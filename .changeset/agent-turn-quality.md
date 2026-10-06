---
"@moxxy/sdk": minor
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

The agent checks live facts — prices, timetables, availability, news — before stating them, and says so plainly when it has not. Redoing earlier work keeps every choice you already settled (dates, one-way or return), and the record of an older turn now keeps your own words, so such a choice survives once the turn is summarized. Moxxy speaks of herself in one form in Polish ("sprawdziłam") in both the chat and Voice Mode, instead of switching between "sprawdziłam" and "sprawdziłem". The chat no longer shows "Context compacted" after nearly every reply: the routine record of a finished turn only moves the context meter, and a compaction the context forced is still announced. `Sleep` no longer invites waiting on an app or page the agent acted on, or retrying a lasting condition such as a Wayland session.

`@moxxy/sdk` adds `AGENT_CONDUCT`, `SELF_REFERENCE_NOTE`, `withAgentConduct`, and an optional `routine` flag on `CompactionEvent`.
