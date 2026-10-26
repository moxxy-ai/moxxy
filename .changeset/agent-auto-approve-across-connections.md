---
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Auto-approve follows the person across connections: a switch they set stays as they set it on every agent the conversation goes to, both ways. Until they set it, each agent runs as it is set up on its own and that no longer carries over: a conversation that came back from a Codex set never to ask to Claude (whose settings ask, or name no mode), or to a model provider of Moxxy's own, asks again instead of acting without asking.
