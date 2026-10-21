---
"@moxxy/cli": patch
"@moxxy/desktop": patch
"@moxxy/sdk": patch
---

An agent that comes back to a conversation, or goes on in a new session of its own, acts on the person's new message again instead of taking it for part of the earlier turns Moxxy hands it. Moxxy's record of the conversation now ends by saying that the person's newest message comes next, and Claude gets the record in a message of its own before the person's message, as it already did before a goal; on the first message after a switch Claude answers a few seconds later.
