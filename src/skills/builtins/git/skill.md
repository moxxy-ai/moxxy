# git

Run any local git command. Arguments are passed directly to git.

`<invoke name="git">["status"]</invoke>`
`<invoke name="git">["add", "."]</invoke>`
`<invoke name="git">["commit", "-m", "feat: add feature"]</invoke>`
`<invoke name="git">["push", "origin", "main"]</invoke>`
`<invoke name="git">["log", "--oneline", "-5"]</invoke>`
`<invoke name="git">["checkout", "-b", "my-branch"]</invoke>`
`<invoke name="git">["diff"]</invoke>`

For GitHub actions (issues, PRs, forks), use the `github` skill.
