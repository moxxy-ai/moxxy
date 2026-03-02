# Git Primitives

Git primitives give agents full version control capabilities: initializing repos, cloning, branching, committing, pushing, creating pull requests, and managing worktrees. Several operations integrate with the vault for credential management.

## git.init

Initialize a new git repository.

**Parameters**:

```json
{
  "path": ".",
  "default_branch": "main"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | No | `.` | Directory to initialize (within workspace) |
| `default_branch` | string | No | `main` | Default branch name |

## git.clone

Clone a repository into the workspace.

**Parameters**:

```json
{
  "url": "https://github.com/user/repo.git",
  "path": "repo",
  "branch": "main"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | string | Yes | -- | Repository URL |
| `path` | string | No | derived from URL | Target directory |
| `branch` | string | No | default | Branch to checkout |

**Vault integration**: For private repositories, the agent needs a `github-token` vault grant. The clone primitive injects the token into the URL for HTTPS authentication.

## git.status

Show the working tree status.

**Parameters**:

```json
{
  "path": "."
}
```

**Result**:

```json
{
  "branch": "feature/auth-refactor",
  "modified": ["src/auth.rs", "src/lib.rs"],
  "untracked": ["src/new_file.rs"],
  "staged": ["src/auth.rs"]
}
```

## git.checkout

Switch or create branches.

**Parameters**:

```json
{
  "branch": "feature/new-feature",
  "create": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `branch` | string | Yes | -- | Branch name |
| `create` | boolean | No | false | Create branch if it does not exist |

## git.commit

Stage files and create a commit.

**Parameters**:

```json
{
  "message": "refactor: extract auth middleware",
  "files": ["src/auth.rs", "src/middleware.rs"],
  "all": false
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `message` | string | Yes | -- | Commit message |
| `files` | string[] | No | `[]` | Files to stage |
| `all` | boolean | No | false | Stage all modified files |

**Vault integration**: The commit primitive can read `git-user-name` and `git-user-email` from the vault to configure the commit author.

## git.push

Push commits to a remote.

**Parameters**:

```json
{
  "remote": "origin",
  "branch": "feature/auth-refactor",
  "force": false
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `remote` | string | No | `origin` | Remote name |
| `branch` | string | No | current | Branch to push |
| `force` | boolean | No | false | Force push |

**Vault integration**: For HTTPS remotes, the push primitive injects a `github-token` from the vault for authentication.

## git.fork

Fork a GitHub repository via the GitHub API.

**Parameters**:

```json
{
  "owner": "original-owner",
  "repo": "original-repo"
}
```

**Vault integration**: Requires a `github-token` vault grant with repo scope.

## git.pr_create

Create a GitHub pull request.

**Parameters**:

```json
{
  "owner": "user",
  "repo": "my-repo",
  "title": "refactor: extract auth middleware",
  "body": "This PR extracts the auth middleware into its own module.",
  "head": "feature/auth-refactor",
  "base": "main"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | Yes | Repository owner |
| `repo` | string | Yes | Repository name |
| `title` | string | Yes | PR title |
| `body` | string | No | PR description |
| `head` | string | Yes | Source branch |
| `base` | string | Yes | Target branch |

**Vault integration**: Requires a `github-token` vault grant.

## git.worktree_add

Create a git worktree for parallel feature work.

**Parameters**:

```json
{
  "path": "../worktree-auth",
  "branch": "feature/auth-refactor"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Path for the new worktree |
| `branch` | string | Yes | Branch for the worktree |

## git.worktree_list

List all worktrees.

**Parameters**:

```json
{}
```

**Result**:

```json
{
  "worktrees": [
    {"path": "/home/user/project", "branch": "main", "head": "abc123"},
    {"path": "/home/user/worktree-auth", "branch": "feature/auth", "head": "def456"}
  ]
}
```

## git.worktree_remove

Remove a worktree.

**Parameters**:

```json
{
  "path": "../worktree-auth",
  "force": false
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | Yes | -- | Worktree path |
| `force` | boolean | No | false | Force removal even with changes |

## Example Skill Declaration

A full git workflow skill:

```yaml
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
safety_notes: "Full git workflow with push access. Requires github-token vault grant."
```
