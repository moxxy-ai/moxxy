# github

Interact with GitHub repos. Requires `GITHUB_TOKEN` in vault.

**Create issue:** `<invoke name="github">["issue", "owner/repo", "Title", "Body text"]</invoke>`
**Create draft PR:** `<invoke name="github">["pr", "owner/repo", "Title", "Description", "user:branch", "main"]</invoke>`
**Fork repo:** `<invoke name="github">["fork", "owner/repo"]</invoke>`
**Clone repo (into agent workspace):** `<invoke name="github">["clone", "owner/repo"]</invoke>`
**Clone repo (custom dir):** `<invoke name="github">["clone", "owner/repo", "/path/to/dir"]</invoke>`
**Comment:** `<invoke name="github">["comment", "owner/repo", "42", "Comment text"]</invoke>`
**List issues:** `<invoke name="github">["list_issues", "owner/repo"]</invoke>`
**List PRs:** `<invoke name="github">["list_prs", "owner/repo"]</invoke>`
