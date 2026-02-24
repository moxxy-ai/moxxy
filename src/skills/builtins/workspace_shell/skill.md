# workspace_shell

Run shell commands within the agent workspace. Locked to workspace directory only.
Use this for build/test/install commands in cloned repos.

**Install dependencies:**
`<invoke name="workspace_shell">["myrepo", "npm install"]</invoke>`

**Build project:**
`<invoke name="workspace_shell">["myrepo", "npm run build"]</invoke>`

**Run tests:**
`<invoke name="workspace_shell">["myrepo", "cargo test"]</invoke>`

**Run in subdirectory:**
`<invoke name="workspace_shell">["myrepo/frontend", "npm run dev"]</invoke>`

**Chain commands:**
`<invoke name="workspace_shell">["myrepo", "npm install && npm run build"]</invoke>`

Cannot run commands outside the agent workspace.
