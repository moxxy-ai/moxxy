---
'@moxxy/cli': patch
'@moxxy/sdk': patch
---

A tool now declares that the user's refusal ends the turn with `refusalEndsTurn` (Computer Use tools set it), instead of the SDK matching `computer_` names. Only the user's answer ends the turn: a `permissions.json` rule or a plugin hook refusing such a tool comes back to the model as a failed step, and a standing rule's refusal is now recorded as `policy` rather than `resolver`.
