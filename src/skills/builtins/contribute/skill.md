# contribute

Suggest features or contribute code to the moxxy project via GitHub. This skill lets you create issues with feature ideas, fork the repo to implement changes, and open draft pull requests — all from within your agent.

**Prerequisite:** A GitHub Personal Access Token must be stored in the vault under the exact name `GITHUB_TOKEN` (with `repo` scope).

- **Via web dashboard:** Go to the Vault tab → add a secret named `GITHUB_TOKEN`
- **Via skill:** `<invoke name="manage_vault">["set", "GITHUB_TOKEN", "ghp_your_token_here"]</invoke>`
- **Create a token:** Visit https://github.com/settings/tokens → Generate new token (classic) → select `repo` scope

If the token is missing, the skill will prompt the user to provide one.

## Actions

### Suggest a feature (create an issue)
`<invoke name="contribute">["suggest", "Feature title", "Detailed description of the feature, why it's useful, and how it could work."]</invoke>`

Creates a GitHub issue on `moxxy-ai/moxxy` with your suggestion.

### Implement a feature (fork + branch)
`<invoke name="contribute">["implement", "Feature title", "What this PR will do", "feat/my-feature-branch"]</invoke>`

Forks the moxxy repo to your GitHub account, clones it locally, and creates a feature branch. After this, use `host_shell` and `git` skills to make your changes and commit them.

### Submit your implementation (open a draft PR)
`<invoke name="contribute">["submit", "PR title", "Description of what was changed and why", "feat/my-feature-branch"]</invoke>`

Pushes your branch and opens a draft pull request against the upstream moxxy repository.

### Check your contributions
`<invoke name="contribute">["status"]</invoke>`

Lists your open issues and pull requests on the moxxy repo.

## Full workflow example

```
1. Suggest the idea:
   <invoke name="contribute">["suggest", "Add dark mode to web dashboard", "The web dashboard currently only has a light theme. Adding dark mode would improve usability in low-light environments and reduce eye strain."]</invoke>

2. Start implementing:
   <invoke name="contribute">["implement", "Add dark mode to web dashboard", "Adds CSS dark mode toggle and theme variables", "feat/dark-mode"]</invoke>

3. Make changes (use host_shell and git skills in the working directory)

4. Submit the PR:
   <invoke name="contribute">["submit", "feat: add dark mode to web dashboard", "Adds a dark mode toggle to the web dashboard with CSS custom properties for theming.", "feat/dark-mode"]</invoke>

5. Check status:
   <invoke name="contribute">["status"]</invoke>
```

## Notes
- Issues are labeled as agent-submitted for easy identification by maintainers.
- PRs are always opened as **drafts** so a human maintainer can review before merging.
- The `implement` action clones to `/tmp/moxxy-contribute-*` — use `host_shell` to navigate there.
- You need `git` installed on the host system for the implement/submit actions.
