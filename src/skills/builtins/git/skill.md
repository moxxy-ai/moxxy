# git

Run any local git command. Arguments are passed directly to git.

`<invoke name="git">["status"]</invoke>`
`<invoke name="git">["add", "."]</invoke>`
`<invoke name="git">["commit", "-m", "feat: add feature"]</invoke>`
`<invoke name="git">["push", "origin", "main"]</invoke>`
`<invoke name="git">["log", "--oneline", "-5"]</invoke>`
`<invoke name="git">["checkout", "-b", "my-branch"]</invoke>`
`<invoke name="git">["diff"]</invoke>`

**Operate on a repo in the workspace (use -C):**
`<invoke name="git">["-C", "/path/to/repo", "status"]</invoke>`
`<invoke name="git">["-C", "/path/to/repo", "checkout", "-b", "feat/my-feature"]</invoke>`
`<invoke name="git">["-C", "/path/to/repo", "add", "."]</invoke>`
`<invoke name="git">["-C", "/path/to/repo", "commit", "-m", "feat: add feature"]</invoke>`
`<invoke name="git">["-C", "/path/to/repo", "push", "origin", "feat/my-feature"]</invoke>`

For GitHub actions (issues, PRs, forks), use the `github` skill.
