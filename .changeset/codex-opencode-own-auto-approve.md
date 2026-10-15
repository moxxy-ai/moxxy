---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Codex and OpenCode show their real auto-approve from the moment a conversation opens, not from the first message. Codex is asked for the folder's config by a short-lived `codex app-server` (no thread is started) and OpenCode for its build agent's rules. Work outside the project still asks the person while auto-approve is the one OpenCode's own rules turned on, also after a new OpenCode loads the session; once the person chose auto-approve it no longer asks. The SDK adds `AgentStepRequest.autoApproveFromAgent` and `autoApproveFromAgent`.
