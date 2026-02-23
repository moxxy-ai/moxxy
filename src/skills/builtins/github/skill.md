# github

Interact with any GitHub repository. Create issues, fork repos, clone repos, open pull requests, comment on issues, and list issues or PRs.

**Prerequisite:** A GitHub Personal Access Token must be stored in the vault under the exact name `GITHUB_TOKEN` (with `repo` scope).

- **Via web dashboard:** Go to the Vault tab and add a secret named `GITHUB_TOKEN`
- **Via skill:** `<invoke name="manage_vault">["set", "GITHUB_TOKEN", "ghp_your_token_here"]</invoke>`
- **Create a token:** Visit https://github.com/settings/tokens, generate a new token (classic), and select `repo` scope

## Actions

### Create an issue
`<invoke name="github">["issue", "owner/repo", "Issue title", "Detailed description of the issue."]</invoke>`

Creates a new issue on the specified repository.

### Fork a repository
`<invoke name="github">["fork", "owner/repo"]</invoke>`

Forks the repository to your GitHub account.

### Clone a repository
`<invoke name="github">["clone", "owner/repo"]</invoke>`

Clones the repository to a local temp directory. Returns the path.

Optionally specify a target directory:
`<invoke name="github">["clone", "owner/repo", "/tmp/my-clone"]</invoke>`

### Create a pull request
`<invoke name="github">["pr", "owner/repo", "PR title", "PR description", "head_user:branch_name", "base_branch"]</invoke>`

Opens a draft pull request. The `head` is in `user:branch` format, and `base` is the target branch (usually `main`).

### Comment on an issue or PR
`<invoke name="github">["comment_issue", "owner/repo", "42", "This is my comment."]</invoke>`

Adds a comment to the specified issue or pull request number.

### List open issues
`<invoke name="github">["list_issues", "owner/repo"]</invoke>`

Lists open issues on the repository.

### List open pull requests
`<invoke name="github">["list_prs", "owner/repo"]</invoke>`

Lists open pull requests on the repository.

## Full workflow example: File an issue

```
<invoke name="github">["issue", "octocat/hello-world", "Bug: login page broken", "The login page returns a 500 error when submitting the form. Steps to reproduce: 1. Go to /login 2. Enter credentials 3. Click submit"]</invoke>
```

## Full workflow example: Fork, edit, and open a PR

```
1. Fork the repo:
   <invoke name="github">["fork", "owner/repo"]</invoke>

2. Clone your fork:
   <invoke name="github">["clone", "your-username/repo"]</invoke>

3. Make changes using host_shell and git skills in the cloned directory

4. Push your branch:
   <invoke name="host_shell">["cd /tmp/github-repo-* && git push origin my-branch"]</invoke>

5. Open a draft PR:
   <invoke name="github">["pr", "owner/repo", "feat: add contributions section", "Added a contributions section to README.md", "your-username:my-branch", "main"]</invoke>
```

## Notes
- All PRs are opened as **drafts** so a human can review before merging.
- The `clone` action clones to `/tmp/github-<repo>-<pid>/` by default.
- You need `git` installed on the host system for clone operations.
- The `owner/repo` format is required for all actions (e.g., `moxxy-ai/moxxy`).
