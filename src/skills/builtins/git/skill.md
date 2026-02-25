# git

Run local git commands with managed worktree isolation.

Start an isolated task workspace for a repo:
`<invoke name="git">["ws", "init", "moxxy-ai/moxxy", "main", "fix-auth-bug"]</invoke>`

Switch/list active worktrees:
`<invoke name="git">["ws", "list"]</invoke>`
`<invoke name="git">["ws", "use", "fix-auth-bug-20260225-103000"]</invoke>`
`<invoke name="git">["ws", "active"]</invoke>`

After `ws init`/`ws use`, regular commands run in the active worktree by default:
`<invoke name="git">["status"]</invoke>`
`<invoke name="git">["checkout", "-b", "feat/my-feature"]</invoke>`
`<invoke name="git">["add", "."]</invoke>`
`<invoke name="git">["commit", "-m", "feat: add feature"]</invoke>`
`<invoke name="git">["push", "origin", "feat/my-feature"]</invoke>`

Or use explicit path:
`<invoke name="git">["-C", "/path/to/repo", "status"]</invoke>`

For GitHub API actions (issues/PRs/comments/forks), use the `github` skill.
