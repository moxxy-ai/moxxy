---
"@moxxy/sdk": minor
"@moxxy/cli": patch
---

OpenCode agent: work outside the project folder, which OpenCode asks about even on its defaults, still goes to the person while auto-approve is the one Moxxy turned on for a new conversation; once the person switches auto-approve themselves, Moxxy answers it too. Agent approvals take `askPerson` for this (`AgentApprovalRequest.askPerson`, `PermissionContext.askPerson`), which lets the person answer even while auto-approve is on; standing rules still decide first.
