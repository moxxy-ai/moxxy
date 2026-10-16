---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Auto-approve on an agent connection is the truth from the first moment and the person's switch always wins. A conversation on the Claude connection reads how the person's Claude runs on its own (its settings, merged and trust-filtered the way Claude does) as it starts, so the switch shows on for a Claude that defaults to bypass permissions before the first message; once the person turns it off, Claude starts asking even over that default, also after a restart. Codex and OpenCode no longer turn on auto-approve the person turned off before their first message. The SDK adds `ProviderDef.ownAutoApprove`, `AgentStepRequest.autoApproveRecorded` and `autoApproveRecorded`.
