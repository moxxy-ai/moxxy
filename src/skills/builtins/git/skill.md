# git

Execute local git commands and interact with GitHub repositories. This single skill handles both local version control (`git status`, `git commit`, etc.) and GitHub API operations (create issues, open PRs, fork repos, etc.).

## Local git commands

Pass any git arguments directly:

`<invoke name="git">["status"]</invoke>`
`<invoke name="git">["add", "."]</invoke>`
`<invoke name="git">["commit", "-m", "feat: add new feature"]</invoke>`
`<invoke name="git">["push", "origin", "my-branch"]</invoke>`

If `git` is not installed on the system, the skill falls back to a REST API proxy.

## GitHub API actions

These actions require a `GITHUB_TOKEN` stored in the vault (with `repo` scope).

- **Via web dashboard:** Go to the Vault tab and add a secret named `GITHUB_TOKEN`
- **Via skill:** `<invoke name="manage_vault">["set", "GITHUB_TOKEN", "ghp_your_token_here"]</invoke>`
- **Create a token:** Visit https://github.com/settings/tokens, generate a new token (classic), and select `repo` scope

### Create an issue
`<invoke name="git">["issue", "owner/repo", "Issue title", "Detailed description of the issue."]</invoke>`

### Fork a repository
`<invoke name="git">["fork", "owner/repo"]</invoke>`

### Clone a GitHub repository (authenticated)
`<invoke name="git">["clone_repo", "owner/repo"]</invoke>`

Optionally specify a target directory:
`<invoke name="git">["clone_repo", "owner/repo", "/tmp/my-clone"]</invoke>`

### Create a pull request
`<invoke name="git">["pr", "owner/repo", "PR title", "PR description", "head_user:branch_name", "base_branch"]</invoke>`

Opens a draft pull request. The `head` is in `user:branch` format, and `base` is the target branch (usually `main`).

### Comment on an issue or PR
`<invoke name="git">["comment_issue", "owner/repo", "42", "This is my comment."]</invoke>`

### List open issues
`<invoke name="git">["list_issues", "owner/repo"]</invoke>`

### List open pull requests
`<invoke name="git">["list_prs", "owner/repo"]</invoke>`

## Full workflow example: File an issue

```
<invoke name="git">["issue", "octocat/hello-world", "Bug: login page broken", "The login page returns a 500 error when submitting the form."]</invoke>
```

## Full workflow example: Fork, edit, and open a PR

```
1. Fork the repo:
   <invoke name="git">["fork", "owner/repo"]</invoke>

2. Clone your fork:
   <invoke name="git">["clone_repo", "your-username/repo"]</invoke>

3. Make changes using host_shell in the cloned directory

4. Stage and commit:
   <invoke name="git">["add", "."]</invoke>
   <invoke name="git">["commit", "-m", "feat: add contributions section"]</invoke>

5. Push your branch:
   <invoke name="git">["push", "origin", "my-branch"]</invoke>

6. Open a draft PR:
   <invoke name="git">["pr", "owner/repo", "feat: add contributions section", "Added a contributions section to README.md", "your-username:my-branch", "main"]</invoke>
```

## Notes
- All PRs are opened as **drafts** so a human can review before merging.
- The `clone_repo` action clones to `/tmp/git-<repo>-<pid>/` by default.
- Use `clone_repo` (not `clone`) for the GitHub authenticated clone action. Plain `clone` passes through to native `git clone`.
- The `owner/repo` format is required for all GitHub actions (e.g., `moxxy-ai/moxxy`).
