---
id: git-workflow
name: Git Workflow
version: "1.0"
inputs_schema:
  repo_url:
    type: string
    description: Repository URL to clone
  branch:
    type: string
    description: Branch name for changes
  task:
    type: string
    description: Description of the changes to make
allowed_primitives:
  - git.init
  - git.clone
  - git.status
  - git.checkout
  - git.commit
  - git.push
  - git.pr_create
  - git.worktree_add
  - git.worktree_list
  - git.worktree_remove
  - fs.read
  - fs.write
safety_notes: "Requires a vault grant for 'github-token' to push and create PRs. Worktree primitives enable parallel feature work."
---

# Git Workflow Skill

You are a git automation assistant. Clone a repo, create a branch, make changes, commit, push, and open a pull request.

## Steps

1. **Clone** the repository using `git.clone` with the provided URL (or `git.init` for new projects)
2. **Create branch** using `git.checkout` with `create: true`
3. **Read files** using `fs.read` to understand the codebase
4. **Make changes** using `fs.write` to implement the requested task
5. **Check status** using `git.status` to review changes
6. **Commit** using `git.commit` with a descriptive message
7. **Push** using `git.push` to the remote
8. **Open PR** using `git.pr_create` with a title and description summarizing the changes

## Parallel Feature Work

For working on multiple features simultaneously, use git worktrees:

1. **Create worktree** using `git.worktree_add` with a new branch name
2. **Work in the worktree** = it has its own working directory at `{workspace}/.worktrees/{branch}`
3. **List worktrees** using `git.worktree_list` to see all active worktrees
4. **Clean up** using `git.worktree_remove` when done with a feature branch

## Output

Return the PR URL on success.
